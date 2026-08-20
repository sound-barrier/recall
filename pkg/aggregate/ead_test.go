package aggregate_test

import (
	"testing"

	"recall/pkg/aggregate"
	"recall/pkg/db"
	"recall/pkg/parser"
)

// The player's eliminations, assists and deaths are ONE fact. Two screenshots
// observe it — the SUMMARY performance panel and the TEAMS scoreboard — and
// whichever one the corpus happens to hold, the match ships the number.
func TestAggregate_ASummaryOnlyMatchStillShipsItsEliminations(t *testing.T) {
	snap := db.Screenshots{
		Summaries: []db.SummaryRow{{
			ID: 1, Filename: "s.png", MatchKey: "m1", ParsedAt: "2026-05-10T21:30:00Z",
			Result: "victory", Eliminations: 17, Assists: 9, Deaths: 4,
			PerfElimAvgPer10Min: 14.2,
		}},
	}
	recs := aggregate.Screenshots(snap)
	if len(recs) != 1 {
		t.Fatalf("want 1 record, got %d", len(recs))
	}
	d := recs[0].Data
	if d.Eliminations != 17 || d.Assists != 9 || d.Deaths != 4 {
		t.Errorf("summary-only E/A/D = %d/%d/%d, want 17/9/4", d.Eliminations, d.Assists, d.Deaths)
	}
}

// The teams scoreboard and the summary panel are two observations of the same
// numbers, so the fold reconciles them into one — it does not carry both.
func TestAggregate_TeamsAndSummaryReconcileToOneEliminationsNumber(t *testing.T) {
	snap := db.Screenshots{
		Summaries: []db.SummaryRow{{
			ID: 1, Filename: "20260510_213000_s.png", MatchKey: "m1", ParsedAt: "2026-05-10T21:30:00Z",
			Result: "victory", Eliminations: 17, Assists: 9, Deaths: 4,
			PerfElimAvgPer10Min: 14.2,
		}},
		Teams: []db.TeamsRow{{
			ID: 1, Filename: "20260510_212800_t.png", MatchKey: "m1", ParsedAt: "2026-05-10T21:28:00Z",
			Eliminations: 17, Assists: 9, Deaths: 4, Damage: 9000,
		}},
	}
	recs := aggregate.Screenshots(snap)
	if len(recs) != 1 {
		t.Fatalf("want 1 record, got %d", len(recs))
	}
	aggregate.ApplyReadTimeInference(&recs[0].Data)
	d := recs[0].Data
	if d.Eliminations != 17 {
		t.Errorf("folded eliminations = %d, want 17", d.Eliminations)
	}
	if d.Performance == nil {
		t.Fatal("summary contributed a performance panel, want it on the record")
	}
	if got := d.Performance.Eliminations.Total; got != d.Eliminations {
		t.Errorf("performance total = %d, eliminations = %d — one fact, two answers", got, d.Eliminations)
	}
}

// Correcting the eliminations moves EVERY number that reports them. Before,
// the override moved the scalar and left the performance panel at the OCR's
// value, so the same screen could show 22 and 17 for one match.
func TestAggregate_CorrectingEliminationsMovesThePerformancePanel(t *testing.T) {
	snap := db.Screenshots{
		Summaries: []db.SummaryRow{{
			ID: 1, Filename: "s.png", MatchKey: "m1", ParsedAt: "2026-05-10T21:30:00Z",
			Result: "victory", Eliminations: 17, PerfElimAvgPer10Min: 14.2,
		}},
	}
	recs := aggregate.Screenshots(snap)
	corrected := 22
	aggregate.AttachUserData(recs, map[string]db.UserMatchData{
		"m1": {MatchKey: "m1", Eliminations: &corrected},
	})
	aggregate.ApplyReadTimeInference(&recs[0].Data)
	if got := recs[0].Data.Performance.Eliminations.Total; got != 22 {
		t.Errorf("performance total after the correction = %d, want 22", got)
	}
}

// A teams-only match has no performance panel — nothing observed the per-10-min
// rates — so the record must not grow an invented one.
func TestAggregate_NoPerformancePanelIsNotInvented(t *testing.T) {
	d := parser.MatchResult{Eliminations: 17, Assists: 9, Deaths: 4}
	aggregate.ApplyReadTimeInference(&d)
	if d.Performance != nil {
		t.Errorf("performance = %+v, want nil — no summary screenshot observed one", d.Performance)
	}
}
