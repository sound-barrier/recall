package aggregate_test

import (
	"image"
	"slices"
	"testing"

	"recall/pkg/aggregate"
	"recall/pkg/db"
	"recall/pkg/match"
	"recall/pkg/parser"
)

// misreadSummaryAndTeams is one match whose SUMMARY over-read eliminations
// (74) while its TEAMS screenshot read the 9 the pixels show. Before
// correlation learned to group on a proven misread these split; a key they
// share (a user resolution, say) must not hide the disagreement.
func misreadSummaryAndTeams() db.Screenshots {
	return db.Screenshots{
		Summaries: []db.SummaryRow{{
			Filename: "Overwatch 2 Screenshot 2026.06.07 - 23.00.04.00.png", MatchKey: "m1", ParsedAt: "2026-06-07T23:00:10Z",
			Hero: "lucio", Result: "victory", GameLength: "15:45",
			Eliminations: 74, Assists: 10, Deaths: 5,
			PerfElimAvgPer10Min: 12.97, PerfAssistsAvgPer10Min: 14.41, PerfDeathsAvgPer10Min: 7.21,
			HeroesPlayed: []db.SummaryHeroPlayed{{Hero: "lucio", PercentPlayed: 100, PlayTime: "06:56"}},
		}},
		Teams: []db.TeamsRow{{
			Filename: "Overwatch 2 Screenshot 2026.06.07 - 23.00.06.00.png", MatchKey: "m1", ParsedAt: "2026-06-07T23:00:11Z",
			Eliminations: 9, Assists: 10, Deaths: 5, Damage: 2602, Healing: 3572, Mitigation: 481,
		}},
	}
}

func flagOn(t *testing.T, rec match.Record, field parser.FieldPath) match.FieldFlag {
	t.Helper()
	i := slices.IndexFunc(rec.FieldFlags, func(f match.FieldFlag) bool { return f.Field == field })
	if i < 0 {
		t.Fatalf("no flag on %s; field_flags = %+v", field, rec.FieldFlags)
	}
	return rec.FieldFlags[i]
}

func TestAggregate_FlagsSourcesThatDisagreeUnderOneKey(t *testing.T) {
	recs := aggregate.Screenshots(misreadSummaryAndTeams())
	if len(recs) != 1 {
		t.Fatalf("want one record, got %d", len(recs))
	}

	flag := flagOn(t, recs[0], parser.ScalarPath("eliminations"))
	for _, check := range []match.CheckID{match.CheckSourceDisagreement, match.CheckPerfTotalVsRate} {
		if !slices.Contains(flag.Checks, check) {
			t.Errorf("checks = %v, want %s among them", flag.Checks, check)
		}
	}
	want := match.FieldReading{SourceFile: "Overwatch 2 Screenshot 2026.06.07 - 23.00.06.00.png", Origin: match.OriginOCR, Value: "9"}
	if !slices.Contains(flag.Readings, want) {
		t.Errorf("readings = %+v, want the TEAMS reading %+v", flag.Readings, want)
	}
}

func TestAggregate_CleanMatchCarriesNoFlags(t *testing.T) {
	snap := misreadSummaryAndTeams()
	snap.Summaries[0].Eliminations = 9

	recs := aggregate.Screenshots(snap)

	if len(recs) != 1 || len(recs[0].FieldFlags) != 0 {
		t.Errorf("want one record without flags, got %+v", recs)
	}
}

// TestAggregate_ReadsTheStoredEvidence: the template cross-check reads what a
// parse stored beside the row, found by the screenshot's folder and name.
func TestAggregate_ReadsTheStoredEvidence(t *testing.T) {
	snap := misreadSummaryAndTeams()
	snap.Summaries[0].Eliminations = 9
	teams := snap.Teams[0]
	snap.FieldEvidence = map[db.FileRef]db.ScreenshotEvidence{
		{DirID: db.SentinelScreenshotsDirID, Filename: teams.Filename}: {
			ImageSize: image.Pt(2560, 1440),
			Fields: []parser.FieldEvidence{{
				Field: parser.ScalarPath("damage"), Rect: image.Rect(10, 10, 60, 30),
				Template: &parser.TemplateReading{Value: "2682", Score: 0.95, Margin: 0.2},
			}},
		},
	}

	for name, rec := range map[string]match.Record{
		"Screenshots": aggregate.Screenshots(snap)[0],
		"MatchKey":    mustMatchKey(t, snap, "m1"),
	} {
		t.Run(name, func(t *testing.T) {
			flag := flagOn(t, rec, parser.ScalarPath("damage"))
			want := match.FieldReading{SourceFile: teams.Filename, Origin: match.OriginTemplate, Value: "2682"}
			if !slices.Contains(flag.Readings, want) {
				t.Errorf("readings = %+v, want %+v", flag.Readings, want)
			}
		})
	}
}

func mustMatchKey(t *testing.T, snap db.Screenshots, key string) match.Record {
	t.Helper()
	rec, ok := aggregate.MatchKey(key, snap, aggregate.Sidecars{})
	if !ok {
		t.Fatalf("MatchKey(%q) found nothing", key)
	}
	return rec
}
