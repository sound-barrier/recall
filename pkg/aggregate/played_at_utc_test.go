package aggregate_test

import (
	"testing"

	"recall/pkg/aggregate"
	"recall/pkg/db"
)

// The canonical played_at_utc on a summary row reaches match.Record.Data, and a
// user_match_data override wins (manual matches + edits).
func TestAggregate_PlayedAtUTC_FromSummaryAndOverride(t *testing.T) {
	utc := "2026-05-11T03:29:00Z"
	snap := db.Screenshots{
		Summaries: []db.SummaryRow{{
			ID: 1, Filename: "s.png", MatchKey: "m1", ParsedAt: "2026-05-10T21:30:00Z",
			Result: "victory", Date: "2026-05-10", FinishedAt: "21:29", PlayedAtUTC: &utc,
		}},
	}
	recs := aggregate.Screenshots(snap)
	if len(recs) != 1 {
		t.Fatalf("want 1 record, got %d", len(recs))
	}
	if recs[0].Data.PlayedAtUTC != utc {
		t.Errorf("summary played_at_utc = %q, want %q", recs[0].Data.PlayedAtUTC, utc)
	}

	// An override replaces it (a corrected/manual played instant).
	override := "2026-05-11T04:00:00Z"
	aggregate.AttachUserData(recs, map[string]db.UserMatchData{
		"m1": {MatchKey: "m1", PlayedAtUTC: new(override)},
	})
	if recs[0].Data.PlayedAtUTC != override {
		t.Errorf("override played_at_utc = %q, want %q", recs[0].Data.PlayedAtUTC, override)
	}
}
