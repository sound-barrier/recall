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
	_, err := s.UpsertMatchCoachNote(db.MatchCoachNote{
		NoteID: "note-" + filename, MatchKey: key, CoachName: "Ordo", SessionDate: "2026-08-08",
		Text: "hold high ground", FocusTags: []string{"positioning"},
	})
	mustNoErr(t, err)
	_, err = s.UpsertMatchMoment(db.MatchMoment{MomentID: "moment-" + filename, MatchKey: key, MatchClock: "04:45", Text: "peeled late"})
	mustNoErr(t, err)
	review, err := s.CreateSelfReview(db.SelfReview{ReviewID: "review-" + filename, Title: "Sunday set", MatchKeys: []string{key}})
	mustNoErr(t, err)
	_, err = s.UpsertSelfReviewNote(db.SelfReviewNote{ReviewID: review.ReviewID, MatchKey: key, Kind: "note", Text: "held the choke"})
	mustNoErr(t, err)
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
	if notes, _ := s.LoadMatchCoachNotes(); len(notes) != 0 {
		t.Errorf("received coach notes survived: %v", notes)
	}
	assertNoReviewFamilyTraceRemains(t, s)
}

// assertNoReviewFamilyTraceRemains sweeps two surfaces the original sweep
// never checked, and the Fake drifted on the first: the player's own
// moments, and their self-review notes. The review itself SURVIVES a hard
// delete (it is a fact about the sitting) — only the membership and the
// note go.
func assertNoReviewFamilyTraceRemains(t *testing.T, s db.Store) {
	t.Helper()
	if moments, _ := s.LoadMatchMoments(); len(moments) != 0 {
		t.Errorf("match moments survived: %v", moments)
	}
	if notes, _ := s.LoadSelfReviewNotes(); len(notes) != 0 {
		t.Errorf("self review notes survived: %v", notes)
	}
	reviews, err := s.LoadSelfReviews()
	mustNoErr(t, err)
	if len(reviews) != 1 || len(reviews[0].MatchKeys) != 0 || len(reviews[0].Notes) != 0 {
		t.Errorf("self review after hard delete = %+v, want the review kept with no members and no notes", reviews)
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
	if notes, _ := s.LoadMatchCoachNotes(); len(notes) != 0 {
		t.Errorf("received coach notes survived Clear: %v", notes)
	}
	if moments, _ := s.LoadMatchMoments(); len(moments) != 0 {
		t.Errorf("match moments survived Clear: %v", moments)
	}
	if reviews, _ := s.LoadSelfReviews(); len(reviews) != 0 {
		t.Errorf("self reviews survived Clear: %v", reviews)
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

// The schema pins the reviewer vocabulary — `reviewed_by TEXT NOT NULL CHECK
// (reviewed_by IN ('self','coach'))` — so a reviewer outside that set cannot
// exist in a real store. The Fake must refuse it too. When it does not, every
// app/handler test built on the Fake can reach a state production cannot, and
// the defensive code written to cope with that state reads as live: the
// cross-profile move carried exactly such a guard, on a review row with a
// blank reviewer that only the Fake could produce.
func TestStoreContract_SetReviewRefusesAReviewerOutsideTheVocabulary(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			const key = "match-2026-01-01T12-00-00"
			for _, bad := range []string{"", "SELF", "teammate"} {
				if err := s.SetReview(key, bad); err == nil {
					t.Errorf("SetReview(%q) = nil, want a rejection", bad)
				}
			}
			// The vocabulary itself still round-trips.
			mustNoErr(t, s.SetReview(key, "self"))
			mustNoErr(t, s.SetReview(key, "coach"))
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
			// A sibling screenshot in a different table adopted the same
			// sentinel through the timestamp-window pass. The resolve is
			// keyed on the match_key, not the filename, so it has to move
			// too — leaving it behind strands a row on a key no record
			// surfaces and no second resolve can reach.
			mustNoErr(t, s.UpsertTeams(db.TeamsRow{Filename: "sibling.png", MatchKey: sentinel}))
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
	if len(snap.Teams) != 1 || snap.Teams[0].MatchKey != "match-2026-01-01T12-00-00" {
		t.Errorf("sibling row after resolve = %+v, want rewritten key", snap.Teams)
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

// HardDeleteMatch must leave the key DEAD, not merely unreadable:
// MatchKeyExists is the collision check that guards manual-match creation, so
// a key that still answers "taken" after a delete permanently blocks the user
// from re-entering that minute by hand — with nothing on screen to explain it.
func TestStoreContract_HardDeleteFreesTheKeyForReuse(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			const key = "match-2026-01-01T12-00-00"
			seedFullMatch(t, s, key, "a.png")

			mustNoErr(t, s.HardDeleteMatch(key))

			exists, err := s.MatchKeyExists(key)
			mustNoErr(t, err)
			if exists {
				t.Fatal("MatchKeyExists still claims the hard-deleted key is taken")
			}
			// Re-usable for real: a fresh manual match may claim the key.
			mustNoErr(t, s.UpsertUserMatchData(db.UserMatchData{MatchKey: key, Map: new("busan")}))
			if exists, _ := s.MatchKeyExists(key); !exists {
				t.Error("the re-created key is not visible to MatchKeyExists")
			}
		})
	}
}

// Candidates come back nearest-first on BOTH read surfaces — the per-file
// lookup the resolver validates against and the bulk map the aggregator turns
// into the "Needs your review" list. The order is the ranking the user sees;
// insertion order is whatever the correlator happened to emit.
func TestStoreContract_AmbiguousCandidatesReadNearestFirst(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			mustNoErr(t, s.ApplyAmbiguity("pending.png", []db.AmbiguousCandidate{
				{MatchKey: "match-far", DistanceSeconds: 900},
				{MatchKey: "match-near", DistanceSeconds: 45},
				{MatchKey: "match-mid", DistanceSeconds: 300},
			}))
			want := []string{"match-near", "match-mid", "match-far"}

			cands, err := s.LoadAmbiguousCandidatesFor("pending.png")
			mustNoErr(t, err)
			assertCandidateOrder(t, "LoadAmbiguousCandidatesFor", cands, want)

			snap, err := s.LoadAll()
			mustNoErr(t, err)
			assertCandidateOrder(t, "LoadAll", snap.AmbiguousCandidates["pending.png"], want)
		})
	}
}

// assertCandidateOrder pins the match_key sequence one read surface returned.
func assertCandidateOrder(t *testing.T, surface string, got []db.AmbiguousCandidate, want []string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("%s returned %+v, want %d candidates", surface, got, len(want))
	}
	for i, key := range want {
		if got[i].MatchKey != key {
			t.Errorf("%s candidate[%d] = %q, want %q (ascending distance)", surface, i, got[i].MatchKey, key)
		}
	}
}

// Presence of a candidate row IS the ambiguity flag, so ApplyAmbiguity has to
// REPLACE the set rather than add to it: a re-parse that narrows the field
// must not leave the ruled-out matches on the review card, and one that
// resolves the ambiguity entirely (no candidates) must clear the flag.
func TestStoreContract_ApplyAmbiguityReplacesTheCandidateSet(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			mustNoErr(t, s.ApplyAmbiguity("pending.png", []db.AmbiguousCandidate{
				{MatchKey: "match-a", DistanceSeconds: 60},
				{MatchKey: "match-b", DistanceSeconds: 120},
			}))
			mustNoErr(t, s.ApplyAmbiguity("pending.png", []db.AmbiguousCandidate{
				{MatchKey: "match-b", DistanceSeconds: 120},
			}))
			cands, err := s.LoadAmbiguousCandidatesFor("pending.png")
			mustNoErr(t, err)
			assertCandidateOrder(t, "after narrowing re-apply", cands, []string{"match-b"})

			mustNoErr(t, s.ApplyAmbiguity("pending.png", nil))
			cands, err = s.LoadAmbiguousCandidatesFor("pending.png")
			mustNoErr(t, err)
			if len(cands) != 0 {
				t.Errorf("an empty candidate set left %+v behind; the ambiguity flag never clears", cands)
			}
		})
	}
}

// The "ambiguous-" prefix is the whole authorization check on a rewrite that
// re-keys every parent row it touches. A caller passing an ordinary match key
// must be refused outright — not silently allowed to re-key a real match onto
// another one — and must leave the candidate set untouched for the real
// resolve to use.
func TestStoreContract_ResolveAmbiguousRefusesANonSentinelKey(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			const victim = "match-2026-01-01T12-00-00"
			mustNoErr(t, s.UpsertUnknown(db.UnknownRow{Filename: "pending.png", MatchKey: victim}))
			mustNoErr(t, s.ApplyAmbiguity("pending.png", []db.AmbiguousCandidate{
				{MatchKey: "match-2026-01-01T12-30-00", DistanceSeconds: 60},
			}))

			ok, err := s.ResolveAmbiguous("pending.png", victim, "match-2026-01-01T12-30-00")
			if ok || err != nil {
				t.Fatalf("ResolveAmbiguous on a non-sentinel key = (%v, %v), want (false, nil)", ok, err)
			}
			snap, err := s.LoadAll()
			mustNoErr(t, err)
			if len(snap.Unknowns) != 1 || snap.Unknowns[0].MatchKey != victim {
				t.Errorf("parent rows = %+v, want %q untouched", snap.Unknowns, victim)
			}
			if cands, _ := s.LoadAmbiguousCandidatesFor("pending.png"); len(cands) != 1 {
				t.Errorf("candidates = %+v, want the set left intact for a real resolve", cands)
			}
		})
	}
}

// DemoteMatchToAmbiguous is ResolveAmbiguous's inverse — the duplicate sweep
// pulls a freshly-created match back into the review queue and the user pushes
// it back out. A demote of a key no parent row carries must record NOTHING:
// candidate rows keyed to a screenshot that never went ambiguous are orphans
// no record surfaces and no resolve can clear.
func TestStoreContract_DemoteMatchToAmbiguousRoundTripsAndSkipsUnknownKeys(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			const key = "match-2026-01-01T12-00-00"
			const sentinel = "ambiguous-ZHVwLnBuZw"
			cands := []db.AmbiguousCandidate{{MatchKey: "match-2026-01-01T11-30-00", DistanceSeconds: 1800}}

			ok, err := s.DemoteMatchToAmbiguous(key, sentinel, "dup.png", cands)
			if ok || err != nil {
				t.Fatalf("demote of an absent key = (%v, %v), want (false, nil)", ok, err)
			}
			if got, _ := s.LoadAmbiguousCandidatesFor("dup.png"); len(got) != 0 {
				t.Fatalf("demote of an absent key orphaned candidates: %+v", got)
			}

			mustNoErr(t, s.UpsertUnknown(db.UnknownRow{Filename: "dup.png", MatchKey: key}))
			if ok, err := s.DemoteMatchToAmbiguous(key, sentinel, "dup.png", cands); !ok || err != nil {
				t.Fatalf("demote = (%v, %v), want (true, nil)", ok, err)
			}
			assertDemotedThenResolvedBack(t, s, sentinel, key)
		})
	}
}

// assertDemotedThenResolvedBack pins the demote's effect and then walks it
// back with ResolveAmbiguous, the operation it inverts.
func assertDemotedThenResolvedBack(t *testing.T, s db.Store, sentinel, key string) {
	t.Helper()
	snap, err := s.LoadAll()
	mustNoErr(t, err)
	if len(snap.Unknowns) != 1 || snap.Unknowns[0].MatchKey != sentinel {
		t.Fatalf("parent rows after demote = %+v, want the sentinel key", snap.Unknowns)
	}
	if got, _ := s.LoadAmbiguousCandidatesFor("dup.png"); len(got) != 1 {
		t.Fatalf("candidates after demote = %+v, want the recorded set", got)
	}
	if ok, err := s.ResolveAmbiguous("dup.png", sentinel, key); !ok || err != nil {
		t.Fatalf("resolve back = (%v, %v), want (true, nil)", ok, err)
	}
	snap, err = s.LoadAll()
	mustNoErr(t, err)
	if len(snap.Unknowns) != 1 || snap.Unknowns[0].MatchKey != key {
		t.Errorf("parent rows after resolving back = %+v, want %q", snap.Unknowns, key)
	}
}

// NULL means "not overridden, use OCR", so writing nil over a set field is how
// the UI reverts ONE cell to its OCR value. An upsert that merged instead of
// replacing (COALESCE over the excluded value, say) would make single-field
// reverts silently impossible while every other edit still worked.
func TestStoreContract_UserMatchNilScalarRevertsTheOverride(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			const key = "match-2026-01-01T12-00-00"
			mustNoErr(t, s.UpsertUserMatchData(db.UserMatchData{
				MatchKey: key, Map: new("busan"), Damage: new(4200),
			}))
			mustNoErr(t, s.UpsertUserMatchData(db.UserMatchData{
				MatchKey: key, Map: new("busan"), Damage: new(0),
			}))
			all, err := s.LoadAllUserMatchData()
			mustNoErr(t, err)
			if got := all[key].Damage; got == nil || *got != 0 {
				t.Fatalf("Damage = %v, want an explicit 0 (a real edit, not unset)", got)
			}

			mustNoErr(t, s.UpsertUserMatchData(db.UserMatchData{MatchKey: key, Map: new("busan")}))
			all, err = s.LoadAllUserMatchData()
			mustNoErr(t, err)
			if got := all[key].Damage; got != nil {
				t.Errorf("Damage = %v after a nil write, want nil (reverted to OCR)", got)
			}
			if got := all[key].Map; got == nil || *got != "busan" {
				t.Errorf("Map = %v, want the untouched override to survive", got)
			}
		})
	}
}

// The sent ledger round-trips on both implementations: keys keep their
// selection order, listing is newest first, and Clear wipes it (a share is
// bookkeeping, not match history — but "clear everything" means everything).
func TestStoreContract_ShareExportLedgerRoundTrip(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			first, err := s.RecordShareExport("Sable", "watch my ults", "", []string{"k-2", "k-1"})
			mustNoErr(t, err)
			assertRecordedShare(t, first)
			_, err = s.RecordShareExport("Ordo", "", "/tmp/notes.zip", []string{"k-3"})
			mustNoErr(t, err)

			sent, err := s.ListShareExports()
			mustNoErr(t, err)
			assertSentNewestFirst(t, sent)

			mustNoErr(t, s.Clear())
			sent, err = s.ListShareExports()
			mustNoErr(t, err)
			if len(sent) != 0 {
				t.Fatalf("ListShareExports after Clear = %d rows, want 0", len(sent))
			}
		})
	}
}

func assertRecordedShare(t *testing.T, first db.ShareExport) {
	t.Helper()
	if first.ID == 0 || first.ExportedAt == "" {
		t.Fatalf("recorded row = %+v, want an id and a stamp", first)
	}
	if len(first.MatchKeys) != 2 || first.MatchKeys[0] != "k-2" {
		t.Fatalf("match keys = %v, want selection order [k-2 k-1]", first.MatchKeys)
	}
}

func assertSentNewestFirst(t *testing.T, sent []db.ShareExport) {
	t.Helper()
	if len(sent) != 2 {
		t.Fatalf("ListShareExports = %d rows, want 2", len(sent))
	}
	if sent[0].Handle != "Ordo" || sent[1].Handle != "Sable" {
		t.Fatalf("order = [%s %s], want newest first [Ordo Sable]", sent[0].Handle, sent[1].Handle)
	}
	if sent[0].SavedPath != "/tmp/notes.zip" {
		t.Errorf("saved path = %q, want the recorded one", sent[0].SavedPath)
	}
}
