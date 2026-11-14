package db_test

import (
	"testing"

	"recall/pkg/db"
)

// A re-parse can change a screenshot's classification (a rank screen whose
// tier once garbled was stored as a summary row; the parser fix reclassifies
// it). The write path must not strand the old-type row beside the new one —
// DeleteScreenshotSiblings wipes the filename from every screenshot table
// except the one it now belongs to.
func TestDeleteScreenshotSiblings_RemovesStaleTypeRows(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			mustNoErr(t, s.UpsertSummary(db.SummaryRow{Filename: "f.png", MatchKey: "match-2026-07-05T14-54-48", Result: "defeat"}))
			mustNoErr(t, s.UpsertRank(db.RankRow{Filename: "f.png", MatchKey: "match-2026-07-05T14-54-48", Rank: "platinum"}))
			mustNoErr(t, s.DeleteScreenshotSiblings(1, "f.png", "rank"))
			shots, err := s.LoadAll()
			mustNoErr(t, err)
			if len(shots.Summaries) != 0 {
				t.Errorf("stale summary row survived reclassification: %+v", shots.Summaries)
			}
			if len(shots.Ranks) != 1 || shots.Ranks[0].Filename != "f.png" || shots.Ranks[0].Rank != "platinum" {
				t.Errorf("kept rank row damaged: %+v", shots.Ranks)
			}
			if n := len(shots.Teams) + len(shots.Personals) + len(shots.Unknowns); n != 0 {
				t.Errorf("unexpected rows in other tables: %d", n)
			}
		})
	}
}

// Wiping siblings for a file the store has never seen must be a no-op, and
// the kept type's row must survive a repeat call (idempotent).
func TestDeleteScreenshotSiblings_Idempotent(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			if err := s.DeleteScreenshotSiblings(1, "never-seen.png", "summary"); err != nil {
				t.Fatalf("unknown filename must not error: %v", err)
			}
			mustNoErr(t, s.UpsertUnknown(db.UnknownRow{Filename: "u.png", MatchKey: "unmatched-dQ"}))
			for range 2 {
				mustNoErr(t, s.DeleteScreenshotSiblings(1, "u.png", "unknown"))
			}
			shots, err := s.LoadAll()
			mustNoErr(t, err)
			if len(shots.Unknowns) != 1 {
				t.Errorf("kept unknown row must survive repeat sibling wipes, got %d rows", len(shots.Unknowns))
			}
		})
	}
}

// When the sibling wipe removes a match key's LAST parent row, ambiguous
// candidates referencing that key must go too — HardDeleteMatch's own
// documented invariant: resolving a pending screenshot onto a dead key
// would resurrect its identity as a match with only that screenshot.
func TestDeleteScreenshotSiblings_DropsCandidatesOfOrphanedKeys(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			mustNoErr(t, s.UpsertSummary(db.SummaryRow{Filename: "f1.png", MatchKey: "match-2026-07-05T14-54-48"}))
			mustNoErr(t, s.UpsertSummary(db.SummaryRow{Filename: "survivor.png", MatchKey: "match-2026-07-06T10-00-00"}))
			cands := []db.AmbiguousCandidate{
				{MatchKey: "match-2026-07-05T14-54-48", DistanceSeconds: 400},
				{MatchKey: "match-2026-07-06T10-00-00", DistanceSeconds: 500},
			}
			mustNoErr(t, s.ApplyAmbiguity("pending.png", cands))
			// f1's reclassification to rank stores the new row under a
			// DIFFERENT key (EAD bridge), so the old key dies with this wipe.
			mustNoErr(t, s.DeleteScreenshotSiblings(1, "f1.png", "rank"))
			got, err := s.LoadAmbiguousCandidatesFor("pending.png")
			mustNoErr(t, err)
			for _, c := range got {
				if c.MatchKey == "match-2026-07-05T14-54-48" {
					t.Errorf("candidate for the dead key survived: %+v", got)
				}
			}
			if len(got) != 1 || got[0].MatchKey != "match-2026-07-06T10-00-00" {
				t.Errorf("the live key's candidate must survive, got %+v", got)
			}
		})
	}
}

// The all_heroes registry is a sibling too: a screenshot that once
// classified all_heroes (and is skipped on future runs) must leave the
// skip-store when a re-parse reclassifies it, or it can never heal.
func TestDeleteScreenshotSiblings_ClearsAllHeroesRegistry(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			mustNoErr(t, s.UpsertAllHeroesScreenshot("ah.png"))
			mustNoErr(t, s.DeleteScreenshotSiblings(1, "ah.png", "summary"))
			skips, err := s.LoadAllHeroesFilenames()
			mustNoErr(t, err)
			if skips["ah.png"] {
				t.Error("all_heroes registry must forget a reclassified file")
			}
			// Keeping all_heroes must preserve its registry row.
			mustNoErr(t, s.UpsertAllHeroesScreenshot("keep.png"))
			mustNoErr(t, s.DeleteScreenshotSiblings(1, "keep.png", "all_heroes"))
			skips, err = s.LoadAllHeroesFilenames()
			mustNoErr(t, err)
			if !skips["keep.png"] {
				t.Error("all_heroes keepType must preserve the registry row")
			}
		})
	}
}

// The history registry obeys the same rule: a file recognized as the career
// HISTORY list, then reclassified by a later parser, must leave it.
func TestDeleteScreenshotSiblings_ClearsHistoryRegistry(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			mustNoErr(t, s.UpsertHistoryScreenshot("h.png"))
			mustNoErr(t, s.DeleteScreenshotSiblings(1, "h.png", "teams"))
			skips, err := s.LoadHistoryFilenames()
			mustNoErr(t, err)
			if skips["h.png"] {
				t.Error("history registry must forget a reclassified file")
			}
			mustNoErr(t, s.UpsertHistoryScreenshot("keep.png"))
			mustNoErr(t, s.DeleteScreenshotSiblings(1, "keep.png", "history"))
			skips, err = s.LoadHistoryFilenames()
			mustNoErr(t, err)
			if !skips["keep.png"] {
				t.Error("history keepType must preserve the registry row")
			}
		})
	}
}

// A filename is a basename, and two screenshots folders can each hold a
// file of the same name. Reclassifying the one in folder A used to delete
// folder B's row too — a match's screenshot gone because an unrelated
// file elsewhere shared its name.
func TestDeleteScreenshotSiblings_LeavesOtherFoldersAlone(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			dirA, err := s.EnsureScreenshotsDir("/shots/a")
			mustNoErr(t, err)
			dirB, err := s.EnsureScreenshotsDir("/shots/b")
			mustNoErr(t, err)
			mustNoErr(t, s.UpsertSummary(db.SummaryRow{Filename: "f.png", MatchKey: "match-2026-07-05T14-54-48", ScreenshotsDirID: dirA}))
			mustNoErr(t, s.UpsertSummary(db.SummaryRow{Filename: "f.png", MatchKey: "match-2026-08-01T20-00-00", ScreenshotsDirID: dirB}))
			mustNoErr(t, s.UpsertRank(db.RankRow{Filename: "f.png", MatchKey: "match-2026-07-05T14-54-48", ScreenshotsDirID: dirA}))

			mustNoErr(t, s.DeleteScreenshotSiblings(dirA, "f.png", "rank"))

			shots, err := s.LoadAll()
			mustNoErr(t, err)
			if len(shots.Summaries) != 1 || shots.Summaries[0].ScreenshotsDirID != dirB {
				t.Errorf("summaries after reclassifying folder A's f.png = %+v, want folder B's row only", shots.Summaries)
			}
		})
	}
}
