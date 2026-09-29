package db_test

import (
	"testing"

	"recall/pkg/db"
)

// Recognizing a file as a non-match screen retires the Unknown row it may
// have been stored as — and that row's pending ambiguity with it — without
// touching any typed row: an Unknown row claims nothing, a typed row is data.
func TestStoreContract_DeleteUnknownScreenshot_RetiresOnlyTheUnknownState(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			mustNoErr(t, s.UpsertUnknown(db.UnknownRow{Filename: "h.png", MatchKey: "ambiguous:h.png"}))
			mustNoErr(t, s.ApplyAmbiguity("h.png", []db.AmbiguousCandidate{{MatchKey: "k-a"}, {MatchKey: "k-b"}}))
			mustNoErr(t, s.UpsertTeams(db.TeamsRow{Filename: "t.png", MatchKey: "k-t", Eliminations: 3}))

			mustNoErr(t, s.DeleteUnknownScreenshot("h.png"))
			mustNoErr(t, s.DeleteUnknownScreenshot("t.png"))

			snap, err := s.LoadAll()
			mustNoErr(t, err)
			if len(snap.Unknowns) != 0 {
				t.Errorf("unknown row survived: %+v", snap.Unknowns)
			}
			if cands := snap.AmbiguousCandidates["h.png"]; len(cands) != 0 {
				t.Errorf("the retired file's pending candidates survived: %+v", cands)
			}
			if len(snap.Teams) != 1 {
				t.Errorf("a typed row was touched: %d teams rows", len(snap.Teams))
			}
		})
	}
}

// A file both typed-stored and registered as a recognized screen keeps its
// typed row on purpose, and re-parsing it only re-registers it — so it can
// never become fresh, and counting it would promise a gain Re-parse All
// cannot deliver.
func TestStaleParseCount_ExcludesEveryRecognizedRegistry(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			mustNoErr(t, s.UpsertTeams(db.TeamsRow{Filename: "h.png", MatchKey: "k-h", Eliminations: 3}))
			mustNoErr(t, s.UpsertHistoryScreenshot("h.png"))

			n, err := s.StaleParseCount(99)
			mustNoErr(t, err)
			if n != 0 {
				t.Errorf("stale count = %d, want 0 for a history-registered file", n)
			}
		})
	}
}
