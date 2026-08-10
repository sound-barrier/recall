package db_test

import (
	"testing"
	"time"

	"recall/pkg/db"
	"recall/pkg/db/dbtest"
)

// Contract suite: every assertion here runs against BOTH Store
// implementations. dbtest.Fake stands in for SQLStore across the app and
// handler tests, so any semantic divergence between the two silently
// invalidates every test built on the Fake. Divergences found by this
// suite are fixed in whichever implementation is wrong — the SQLStore
// defines the contract unless its behavior is itself the bug.
var storeImpls = []struct {
	name string
	open func(t *testing.T) db.Store
}{
	{"SQLStore", func(t *testing.T) db.Store { t.Helper(); return openMemory(t) }},
	{"Fake", func(t *testing.T) db.Store { t.Helper(); return &dbtest.Fake{} }},
}

// IgnoredAt's wire shape is RFC3339: the STRICT ignored_at column is TEXT
// stamped by strftime('%Y-%m-%dT%H:%M:%SZ','now'), so "2006-01-02T15:04:05Z"
// is stored verbatim — no DATETIME affinity, no driver time.Time round-trip.
// The Fake must match THAT read surface. (The 2026-07 audit claimed the two
// had diverged by comparing the storage format; this test adjudicated the
// claim empirically — both implementations agree on RFC3339.)
func TestStoreContract_IgnoredAtIsRFC3339OnRead(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			mustNoErr(t, s.AddIgnoredScreenshot("shot.png"))
			rows, err := s.ListIgnoredScreenshots()
			mustNoErr(t, err)
			if len(rows) != 1 {
				t.Fatalf("ignored rows = %d, want 1", len(rows))
			}
			if _, err := time.Parse(time.RFC3339, rows[0].IgnoredAt); err != nil {
				t.Fatalf("IgnoredAt %q is not RFC3339: %v", rows[0].IgnoredAt, err)
			}
		})
	}
}

func TestStoreContract_IgnoredAddRemoveRoundTrip(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			mustNoErr(t, s.AddIgnoredScreenshot("a.png"))
			mustNoErr(t, s.AddIgnoredScreenshot("a.png")) // idempotent refresh
			names, err := s.LoadIgnoredFilenames()
			mustNoErr(t, err)
			if !names["a.png"] || len(names) != 1 {
				t.Fatalf("LoadIgnoredFilenames = %v, want exactly a.png", names)
			}
			mustNoErr(t, s.RemoveIgnoredScreenshot("a.png"))
			mustNoErr(t, s.RemoveIgnoredScreenshot("missing.png")) // no-op
			names, err = s.LoadIgnoredFilenames()
			mustNoErr(t, err)
			if len(names) != 0 {
				t.Fatalf("after remove, LoadIgnoredFilenames = %v, want empty", names)
			}
		})
	}
}

func seedFullMatch(t *testing.T, s db.Store, key, filename string) {
	t.Helper()
	mustNoErr(t, s.UpsertSummary(db.SummaryRow{
		Filename: filename, MatchKey: key, Map: "rialto", Result: "victory",
		HeroesPlayed: []db.SummaryHeroPlayed{{Hero: "lucio", PercentPlayed: 100}},
	}))
	mustNoErr(t, s.SetAnnotation(db.Annotation{MatchKey: key, Note: "clutch"}))
	mustNoErr(t, s.SetReview(key, "coach"))
	mustNoErr(t, s.SetMatchQueue(key, "role"))
	mustNoErr(t, s.SetMatchPlayMode(key, "competitive"))
	mustNoErr(t, s.HideMatch(key))
	mapName := "dorado"
	mustNoErr(t, s.UpsertUserMatchData(db.UserMatchData{MatchKey: key, Map: &mapName}))
}

// HardDeleteMatch's contract: NO trace remains on any surface. The Fake
// historically drifted here (left user data / queue / play-mode behind);
// this pins the parity.
func TestStoreContract_HardDeleteLeavesNoTrace(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			const key = "match-2026-01-01T12-00-00"
			seedFullMatch(t, s, key, "a.png")
			mustNoErr(t, s.ApplyAmbiguity("pending.png", []db.AmbiguousCandidate{{MatchKey: key, DistanceSeconds: 60}}))

			mustNoErr(t, s.HardDeleteMatch(key))

			assertNoTraceRemains(t, s)
		})
	}
}

// assertNoTraceRemains sweeps every read surface for leftovers of the
// hard-deleted match.
func assertNoTraceRemains(t *testing.T, s db.Store) {
	t.Helper()
	snap, err := s.LoadAll()
	mustNoErr(t, err)
	if len(snap.Summaries) != 0 {
		t.Errorf("summaries survived hard delete: %+v", snap.Summaries)
	}
	if anns, _ := s.LoadAnnotations(); len(anns) != 0 {
		t.Errorf("annotation survived: %v", anns)
	}
	if revs, _ := s.LoadReviews(); len(revs) != 0 {
		t.Errorf("review survived: %v", revs)
	}
	if qs, _ := s.LoadMatchQueues(); len(qs) != 0 {
		t.Errorf("queue survived: %v", qs)
	}
	if pms, _ := s.LoadMatchPlayModes(); len(pms) != 0 {
		t.Errorf("play mode survived: %v", pms)
	}
	if hidden, _ := s.LoadHiddenKeys(); len(hidden) != 0 {
		t.Errorf("hidden flag survived: %v", hidden)
	}
	if ud, _ := s.LoadAllUserMatchData(); len(ud) != 0 {
		t.Errorf("user data survived: %v", ud)
	}
	if cands, _ := s.LoadAmbiguousCandidatesFor("pending.png"); len(cands) != 0 {
		t.Errorf("ambiguous candidacy survived: %v", cands)
	}
}

// Clear's contract: every surface empties, and the store remains usable
// for immediate re-inserts (SQLStore reseeds the id=1 dir sentinel).
func TestStoreContract_ClearEmptiesEverySurfaceAndStaysUsable(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			const key = "match-2026-01-01T12-00-00"
			seedFullMatch(t, s, key, "a.png")
			mustNoErr(t, s.AddIgnoredScreenshot("b.png"))
			mustNoErr(t, s.UpsertAllHeroesScreenshot("all.png"))

			mustNoErr(t, s.Clear())

			assertClearedSurfaces(t, s)
			// Still usable: a fresh insert relying on the dir default succeeds.
			if err := s.UpsertSummary(db.SummaryRow{Filename: "c.png", MatchKey: "match-2026-01-02T12-00-00"}); err != nil {
				t.Fatalf("insert after Clear: %v", err)
			}
		})
	}
}

// assertClearedSurfaces sweeps the read surfaces Clear must empty.
func assertClearedSurfaces(t *testing.T, s db.Store) {
	t.Helper()
	snap, err := s.LoadAll()
	mustNoErr(t, err)
	if len(snap.Summaries) != 0 || len(snap.AmbiguousCandidates) != 0 {
		t.Errorf("screenshot surfaces survived Clear: %+v", snap)
	}
	if names, _ := s.LoadIgnoredFilenames(); len(names) != 0 {
		t.Errorf("ignored list survived Clear: %v", names)
	}
	if ah, _ := s.LoadAllHeroesFilenames(); len(ah) != 0 {
		t.Errorf("all-heroes list survived Clear: %v", ah)
	}
	if ud, _ := s.LoadAllUserMatchData(); len(ud) != 0 {
		t.Errorf("user data survived Clear: %v", ud)
	}
}

func TestStoreContract_ReviewQueuePlayModeSetClearRoundTrip(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			const key = "match-2026-01-01T12-00-00"
			mustNoErr(t, s.SetReview(key, "self"))
			mustNoErr(t, s.SetMatchQueue(key, "open"))
			mustNoErr(t, s.SetMatchPlayMode(key, "quickplay"))
			assertAuxRowsPresent(t, s, key)
			mustNoErr(t, s.ClearReview(key))
			mustNoErr(t, s.ClearMatchQueue(key))
			mustNoErr(t, s.ClearMatchPlayMode(key))
			assertAuxRowsCleared(t, s)
		})
	}
}

// assertAuxRowsPresent pins the just-set review / queue / play-mode values.
func assertAuxRowsPresent(t *testing.T, s db.Store, key string) {
	t.Helper()
	revs, _ := s.LoadReviews()
	if revs[key].ReviewedBy != "self" {
		t.Errorf("review = %+v, want self", revs[key])
	}
	qs, _ := s.LoadMatchQueues()
	if qs[key].QueueType != "open" {
		t.Errorf("queue = %+v, want open", qs[key])
	}
	pms, _ := s.LoadMatchPlayModes()
	if pms[key].PlayMode != "quickplay" {
		t.Errorf("play mode = %+v, want quickplay", pms[key])
	}
}

// assertAuxRowsCleared pins that the clears left no review / queue /
// play-mode rows behind.
func assertAuxRowsCleared(t *testing.T, s db.Store) {
	t.Helper()
	if revs, _ := s.LoadReviews(); len(revs) != 0 {
		t.Errorf("review survived clear: %v", revs)
	}
	if qs, _ := s.LoadMatchQueues(); len(qs) != 0 {
		t.Errorf("queue survived clear: %v", qs)
	}
	if pms, _ := s.LoadMatchPlayModes(); len(pms) != 0 {
		t.Errorf("play mode survived clear: %v", pms)
	}
}

func TestStoreContract_MatchKeyExistsSeesBothLayers(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			if ok, _ := s.MatchKeyExists("match-2026-01-01T12-00-00"); ok {
				t.Fatal("empty store claims key exists")
			}
			mustNoErr(t, s.UpsertSummary(db.SummaryRow{Filename: "a.png", MatchKey: "match-2026-01-01T12-00-00"}))
			mapName := "dorado"
			mustNoErr(t, s.UpsertUserMatchData(db.UserMatchData{MatchKey: "match-2026-01-02T12-00-00", Map: &mapName}))
			if ok, _ := s.MatchKeyExists("match-2026-01-01T12-00-00"); !ok {
				t.Error("screenshot-layer key not seen")
			}
			if ok, _ := s.MatchKeyExists("match-2026-01-02T12-00-00"); !ok {
				t.Error("user-layer key not seen")
			}
		})
	}
}

func TestStoreContract_ResolveAmbiguousRewritesParentsAndClearsCandidates(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			const sentinel = "ambiguous-cGVuZGluZy5wbmc"
			mustNoErr(t, s.UpsertUnknown(db.UnknownRow{Filename: "pending.png", MatchKey: sentinel}))
			mustNoErr(t, s.ApplyAmbiguity("pending.png", []db.AmbiguousCandidate{{MatchKey: "match-2026-01-01T12-00-00", DistanceSeconds: 60}}))
			ok, err := s.ResolveAmbiguous("pending.png", sentinel, "match-2026-01-01T12-00-00")
			if err != nil || !ok {
				t.Fatalf("ResolveAmbiguous = (%v, %v), want (true, nil)", ok, err)
			}
			assertResolvedOntoKey(t, s)
			// Second resolve on the same key: nothing left → (false, nil).
			if ok, err := s.ResolveAmbiguous("pending.png", sentinel, "match-2026-01-01T12-00-00"); ok || err != nil {
				t.Errorf("re-resolve = (%v, %v), want (false, nil)", ok, err)
			}
		})
	}
}

// assertResolvedOntoKey pins the post-resolve state: parent rewritten onto
// the real key, candidate rows gone.
func assertResolvedOntoKey(t *testing.T, s db.Store) {
	t.Helper()
	snap, err := s.LoadAll()
	mustNoErr(t, err)
	if len(snap.Unknowns) != 1 || snap.Unknowns[0].MatchKey != "match-2026-01-01T12-00-00" {
		t.Errorf("parent row after resolve = %+v, want rewritten key", snap.Unknowns)
	}
	if cands, _ := s.LoadAmbiguousCandidatesFor("pending.png"); len(cands) != 0 {
		t.Errorf("candidates survived resolve: %v", cands)
	}
}

// The failed-file ledger's semantics both implementations must share:
// upsert increments attempts and refreshes error/last_failed_at while
// preserving first_failed_at; remove is idempotent; list is ordered
// most-recently-failed first and returns RFC3339 timestamps.
func TestStoreContract_FailedFileLifecycle(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			mustNoErr(t, s.RecordFailedFile("f.png", 1, "first error"))
			mustNoErr(t, s.RecordFailedFile("f.png", 1, "second error"))
			assertRerecordedFailedRow(t, s)
			mustNoErr(t, s.RemoveFailedFile("f.png"))
			mustNoErr(t, s.RemoveFailedFile("f.png")) // remove absent must be a no-op
			rows, err := s.ListFailedFiles()
			if err != nil || len(rows) != 0 {
				t.Fatalf("want empty after remove, got %v (err %v)", rows, err)
			}
		})
	}
}

// assertRerecordedFailedRow pins the upserted ledger row: one row, bumped
// attempts, refreshed error, RFC3339 timestamps.
func assertRerecordedFailedRow(t *testing.T, s db.Store) {
	t.Helper()
	rows, err := s.ListFailedFiles()
	mustNoErr(t, err)
	if len(rows) != 1 {
		t.Fatalf("want 1 row, got %d", len(rows))
	}
	r := rows[0]
	if r.Attempts != 2 || r.Error != "second error" {
		t.Errorf("row = %+v, want attempts=2 error=second error", r)
	}
	if _, err := time.Parse(time.RFC3339, r.FirstFailedAt); err != nil {
		t.Errorf("FirstFailedAt %q is not RFC3339: %v", r.FirstFailedAt, err)
	}
	if _, err := time.Parse(time.RFC3339, r.LastFailedAt); err != nil {
		t.Errorf("LastFailedAt %q is not RFC3339: %v", r.LastFailedAt, err)
	}
}
