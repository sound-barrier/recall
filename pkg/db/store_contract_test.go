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

// IgnoredAt's wire shape is RFC3339: SQLite stores CURRENT_TIMESTAMP as
// "2006-01-02 15:04:05", but the modernc driver scans DATETIME columns
// through time.Time, so the string the app actually receives is
// "2006-01-02T15:04:05Z" — and the Fake must match THAT read surface.
// (The 2026-07 audit claimed the two had diverged by comparing the
// storage format; this test adjudicated the claim empirically — both
// implementations agree on RFC3339.)
func TestStoreContract_IgnoredAtIsRFC3339OnRead(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			if err := s.AddIgnoredScreenshot("shot.png"); err != nil {
				t.Fatal(err)
			}
			rows, err := s.ListIgnoredScreenshots()
			if err != nil {
				t.Fatal(err)
			}
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
			if err := s.AddIgnoredScreenshot("a.png"); err != nil {
				t.Fatal(err)
			}
			if err := s.AddIgnoredScreenshot("a.png"); err != nil { // idempotent refresh
				t.Fatal(err)
			}
			names, err := s.LoadIgnoredFilenames()
			if err != nil {
				t.Fatal(err)
			}
			if !names["a.png"] || len(names) != 1 {
				t.Fatalf("LoadIgnoredFilenames = %v, want exactly a.png", names)
			}
			if err := s.RemoveIgnoredScreenshot("a.png"); err != nil {
				t.Fatal(err)
			}
			if err := s.RemoveIgnoredScreenshot("missing.png"); err != nil { // no-op
				t.Fatal(err)
			}
			names, err = s.LoadIgnoredFilenames()
			if err != nil {
				t.Fatal(err)
			}
			if len(names) != 0 {
				t.Fatalf("after remove, LoadIgnoredFilenames = %v, want empty", names)
			}
		})
	}
}

func seedFullMatch(t *testing.T, s db.Store, key, filename string) {
	t.Helper()
	if err := s.UpsertSummary(db.SummaryRow{
		Filename: filename, MatchKey: key, Map: "rialto", Result: "victory",
		HeroesPlayed: []db.SummaryHeroPlayed{{Hero: "lucio", PercentPlayed: 100}},
	}); err != nil {
		t.Fatal(err)
	}
	if err := s.SetAnnotation(db.Annotation{MatchKey: key, Note: "clutch"}); err != nil {
		t.Fatal(err)
	}
	if err := s.SetReview(key, "coach"); err != nil {
		t.Fatal(err)
	}
	if err := s.SetMatchQueue(key, "role"); err != nil {
		t.Fatal(err)
	}
	if err := s.SetMatchPlayMode(key, "competitive"); err != nil {
		t.Fatal(err)
	}
	if err := s.HideMatch(key); err != nil {
		t.Fatal(err)
	}
	mapName := "dorado"
	if err := s.UpsertUserMatchData(db.UserMatchData{MatchKey: key, Map: &mapName}); err != nil {
		t.Fatal(err)
	}
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
			if err := s.ApplyAmbiguity("pending.png", []db.AmbiguousCandidate{{MatchKey: key, DistanceSeconds: 60}}); err != nil {
				t.Fatal(err)
			}

			if err := s.HardDeleteMatch(key); err != nil {
				t.Fatal(err)
			}

			snap, err := s.LoadAll()
			if err != nil {
				t.Fatal(err)
			}
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
		})
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
			if err := s.AddIgnoredScreenshot("b.png"); err != nil {
				t.Fatal(err)
			}
			if err := s.UpsertAllHeroesScreenshot("all.png"); err != nil {
				t.Fatal(err)
			}

			if err := s.Clear(); err != nil {
				t.Fatal(err)
			}

			snap, err := s.LoadAll()
			if err != nil {
				t.Fatal(err)
			}
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
			// Still usable: a fresh insert relying on the dir default succeeds.
			if err := s.UpsertSummary(db.SummaryRow{Filename: "c.png", MatchKey: "match-2026-01-02T12-00-00"}); err != nil {
				t.Fatalf("insert after Clear: %v", err)
			}
		})
	}
}

func TestStoreContract_ReviewQueuePlayModeSetClearRoundTrip(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			const key = "match-2026-01-01T12-00-00"
			if err := s.SetReview(key, "self"); err != nil {
				t.Fatal(err)
			}
			if err := s.SetMatchQueue(key, "open"); err != nil {
				t.Fatal(err)
			}
			if err := s.SetMatchPlayMode(key, "quickplay"); err != nil {
				t.Fatal(err)
			}
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
			if err := s.ClearReview(key); err != nil {
				t.Fatal(err)
			}
			if err := s.ClearMatchQueue(key); err != nil {
				t.Fatal(err)
			}
			if err := s.ClearMatchPlayMode(key); err != nil {
				t.Fatal(err)
			}
			if revs, _ := s.LoadReviews(); len(revs) != 0 {
				t.Errorf("review survived clear: %v", revs)
			}
			if qs, _ := s.LoadMatchQueues(); len(qs) != 0 {
				t.Errorf("queue survived clear: %v", qs)
			}
			if pms, _ := s.LoadMatchPlayModes(); len(pms) != 0 {
				t.Errorf("play mode survived clear: %v", pms)
			}
		})
	}
}

func TestStoreContract_MatchKeyExistsSeesBothLayers(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			if ok, _ := s.MatchKeyExists("match-2026-01-01T12-00-00"); ok {
				t.Fatal("empty store claims key exists")
			}
			if err := s.UpsertSummary(db.SummaryRow{Filename: "a.png", MatchKey: "match-2026-01-01T12-00-00"}); err != nil {
				t.Fatal(err)
			}
			mapName := "dorado"
			if err := s.UpsertUserMatchData(db.UserMatchData{MatchKey: "match-2026-01-02T12-00-00", Map: &mapName}); err != nil {
				t.Fatal(err)
			}
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
			if err := s.UpsertUnknown(db.UnknownRow{Filename: "pending.png", MatchKey: sentinel}); err != nil {
				t.Fatal(err)
			}
			if err := s.ApplyAmbiguity("pending.png", []db.AmbiguousCandidate{{MatchKey: "match-2026-01-01T12-00-00", DistanceSeconds: 60}}); err != nil {
				t.Fatal(err)
			}
			ok, err := s.ResolveAmbiguous("pending.png", sentinel, "match-2026-01-01T12-00-00")
			if err != nil || !ok {
				t.Fatalf("ResolveAmbiguous = (%v, %v), want (true, nil)", ok, err)
			}
			snap, err := s.LoadAll()
			if err != nil {
				t.Fatal(err)
			}
			if len(snap.Unknowns) != 1 || snap.Unknowns[0].MatchKey != "match-2026-01-01T12-00-00" {
				t.Errorf("parent row after resolve = %+v, want rewritten key", snap.Unknowns)
			}
			if cands, _ := s.LoadAmbiguousCandidatesFor("pending.png"); len(cands) != 0 {
				t.Errorf("candidates survived resolve: %v", cands)
			}
			// Second resolve on the same key: nothing left → (false, nil).
			if ok, err := s.ResolveAmbiguous("pending.png", sentinel, "match-2026-01-01T12-00-00"); ok || err != nil {
				t.Errorf("re-resolve = (%v, %v), want (false, nil)", ok, err)
			}
		})
	}
}
