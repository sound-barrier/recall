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
			if err := s.UpsertSummary(db.SummaryRow{Filename: "f.png", MatchKey: "match-2026-07-05T14-54-48", Result: "defeat"}); err != nil {
				t.Fatalf("UpsertSummary: %v", err)
			}
			if err := s.UpsertRank(db.RankRow{Filename: "f.png", MatchKey: "match-2026-07-05T14-54-48", Rank: "platinum"}); err != nil {
				t.Fatalf("UpsertRank: %v", err)
			}
			if err := s.DeleteScreenshotSiblings("f.png", "rank"); err != nil {
				t.Fatalf("DeleteScreenshotSiblings: %v", err)
			}
			shots, err := s.LoadAll()
			if err != nil {
				t.Fatalf("LoadAll: %v", err)
			}
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
			if err := s.DeleteScreenshotSiblings("never-seen.png", "summary"); err != nil {
				t.Fatalf("unknown filename must not error: %v", err)
			}
			if err := s.UpsertUnknown(db.UnknownRow{Filename: "u.png", MatchKey: "unmatched-dQ"}); err != nil {
				t.Fatalf("UpsertUnknown: %v", err)
			}
			for range 2 {
				if err := s.DeleteScreenshotSiblings("u.png", "unknown"); err != nil {
					t.Fatalf("DeleteScreenshotSiblings: %v", err)
				}
			}
			shots, err := s.LoadAll()
			if err != nil {
				t.Fatalf("LoadAll: %v", err)
			}
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
			if err := s.UpsertSummary(db.SummaryRow{Filename: "f1.png", MatchKey: "match-2026-07-05T14-54-48"}); err != nil {
				t.Fatalf("UpsertSummary: %v", err)
			}
			if err := s.UpsertSummary(db.SummaryRow{Filename: "survivor.png", MatchKey: "match-2026-07-06T10-00-00"}); err != nil {
				t.Fatalf("UpsertSummary survivor: %v", err)
			}
			cands := []db.AmbiguousCandidate{
				{MatchKey: "match-2026-07-05T14-54-48", DistanceSeconds: 400},
				{MatchKey: "match-2026-07-06T10-00-00", DistanceSeconds: 500},
			}
			if err := s.ApplyAmbiguity("pending.png", cands); err != nil {
				t.Fatalf("ApplyAmbiguity: %v", err)
			}
			// f1's reclassification to rank stores the new row under a
			// DIFFERENT key (EAD bridge), so the old key dies with this wipe.
			if err := s.DeleteScreenshotSiblings("f1.png", "rank"); err != nil {
				t.Fatalf("DeleteScreenshotSiblings: %v", err)
			}
			got, err := s.LoadAmbiguousCandidatesFor("pending.png")
			if err != nil {
				t.Fatalf("LoadAmbiguousCandidatesFor: %v", err)
			}
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
			if err := s.UpsertAllHeroesScreenshot("ah.png"); err != nil {
				t.Fatalf("UpsertAllHeroesScreenshot: %v", err)
			}
			if err := s.DeleteScreenshotSiblings("ah.png", "summary"); err != nil {
				t.Fatalf("DeleteScreenshotSiblings: %v", err)
			}
			skips, err := s.LoadAllHeroesFilenames()
			if err != nil {
				t.Fatalf("LoadAllHeroesFilenames: %v", err)
			}
			if skips["ah.png"] {
				t.Error("all_heroes registry must forget a reclassified file")
			}
			// Keeping all_heroes must preserve its registry row.
			if err := s.UpsertAllHeroesScreenshot("keep.png"); err != nil {
				t.Fatalf("UpsertAllHeroesScreenshot: %v", err)
			}
			if err := s.DeleteScreenshotSiblings("keep.png", "all_heroes"); err != nil {
				t.Fatalf("DeleteScreenshotSiblings: %v", err)
			}
			skips, err = s.LoadAllHeroesFilenames()
			if err != nil {
				t.Fatalf("LoadAllHeroesFilenames: %v", err)
			}
			if !skips["keep.png"] {
				t.Error("all_heroes keepType must preserve the registry row")
			}
		})
	}
}
