package aggregate_test

import (
	"testing"

	"recall/pkg/aggregate"
	"recall/pkg/db"
	"recall/pkg/match"
	"recall/pkg/parser"
)

// Where a flag stands with the user is decided at read time from what they
// did: an edit of the field (or of a collection holding it) settles it, a
// confirmation settles it while the match still reads the value confirmed,
// and anything else leaves it open — a confirmation of a value a later parse
// no longer reads re-opens it.

var elims = parser.ScalarPath("eliminations")

func flaggedRecord(edited []string, flags ...match.FieldFlag) match.Record {
	return match.Record{MatchKey: "m1", EditedFields: edited, FieldFlags: flags}
}

func openFlag(field parser.FieldPath, value string) match.FieldFlag {
	return match.FieldFlag{Field: field, Value: value, State: match.FlagOpen, Checks: []match.CheckID{match.CheckPlausibleRange}}
}

func resolvedState(t *testing.T, rec match.Record, confirmed map[string]db.ConfirmedReadings, field parser.FieldPath) match.FlagState {
	t.Helper()
	recs := []match.Record{rec}
	aggregate.AttachFieldResolutions(recs, confirmed)
	return flagOn(t, recs[0], field).State
}

func TestAttachFieldResolutions_ConfirmationHoldsWhileTheReadingDoes(t *testing.T) {
	confirmed := map[string]db.ConfirmedReadings{"m1": {elims: "74"}}

	if got := resolvedState(t, flaggedRecord(nil, openFlag(elims, "74")), confirmed, elims); got != match.FlagConfirmed {
		t.Errorf("state = %q, want confirmed", got)
	}
}

func TestAttachFieldResolutions_StaleConfirmationReopens(t *testing.T) {
	confirmed := map[string]db.ConfirmedReadings{"m1": {elims: "74"}}

	if got := resolvedState(t, flaggedRecord(nil, openFlag(elims, "9")), confirmed, elims); got != match.FlagOpen {
		t.Errorf("state = %q, want open: the match reads 9 now, and 74 was what the user confirmed", got)
	}
}

func TestAttachFieldResolutions_ConfirmationIsPerMatchAndField(t *testing.T) {
	confirmed := map[string]db.ConfirmedReadings{
		"m2": {elims: "74"},
		"m1": {parser.ScalarPath("deaths"): "74"},
	}

	if got := resolvedState(t, flaggedRecord(nil, openFlag(elims, "74")), confirmed, elims); got != match.FlagOpen {
		t.Errorf("state = %q, want open", got)
	}
}

// An edit settles the flag whatever was confirmed: the user's value replaced
// the reading, so there is nothing left to vouch for.
func TestAttachFieldResolutions_EditOutranksConfirmation(t *testing.T) {
	confirmed := map[string]db.ConfirmedReadings{"m1": {elims: "74"}}
	rec := flaggedRecord([]string{string(elims)}, openFlag(elims, "74"))

	if got := resolvedState(t, rec, confirmed, elims); got != match.FlagEdited {
		t.Errorf("state = %q, want edited", got)
	}
}

// Editing a collection replaces everything in it, so it settles a flag on any
// field under it.
func TestAttachFieldResolutions_EditOfAContainingCollection(t *testing.T) {
	percent := parser.HeroPercentPath("d.va")
	sr := parser.SRPath("soldier 76")
	rec := flaggedRecord([]string{"data.heroes_played", "data.sr"}, openFlag(percent, "90"), openFlag(sr, "7000"))

	for _, field := range []parser.FieldPath{percent, sr} {
		if got := resolvedState(t, rec, nil, field); got != match.FlagEdited {
			t.Errorf("%s: state = %q, want edited", field, got)
		}
	}
}

// A prefix counts only at a path boundary: an edited rank says nothing about
// the rank progress, and a stat cell edited under a hero says nothing about
// which heroes were played.
func TestAttachFieldResolutions_EditCoversOnlyAtAPathBoundary(t *testing.T) {
	progress := parser.ScalarPath("rank_progress")
	heroes := parser.ScalarPath("heroes_played")
	edited := []string{"data.rank", string(parser.HeroStatPath("juno", "weapon_accuracy"))}
	rec := flaggedRecord(edited, openFlag(progress, "150"), openFlag(heroes, "juno"))

	for _, field := range []parser.FieldPath{progress, heroes} {
		if got := resolvedState(t, rec, nil, field); got != match.FlagOpen {
			t.Errorf("%s: state = %q, want open", field, got)
		}
	}
}

// The full read: a confirmed misread stays confirmed through the fold, and a
// streamed single-match read (MatchKey + Sidecars) resolves it the same way.
func TestAggregate_ConfirmedMisreadResolvesOnBothReadPaths(t *testing.T) {
	snap := misreadSummaryAndTeams()
	confirmed := map[string]db.ConfirmedReadings{"m1": {elims: "74"}}

	recs := aggregate.Screenshots(snap)
	aggregate.AttachFieldResolutions(recs, confirmed)
	streamed, ok := aggregate.MatchKey("m1", snap, aggregate.Sidecars{FieldConfirmations: confirmed})
	if !ok {
		t.Fatal("MatchKey found nothing")
	}

	for name, rec := range map[string]match.Record{"Screenshots": recs[0], "MatchKey": streamed} {
		if got := flagOn(t, rec, elims); got.State != match.FlagConfirmed || got.Value != "74" {
			t.Errorf("%s: flag = %+v, want confirmed at 74", name, got)
		}
	}
}

// An edit of the rank or level clears the percentile measured against them,
// so a flag on the percentile is settled too: the record no longer shows the
// value it names, and confirming that value would vouch for a reading the
// user's own edit discarded.
func TestAttachFieldResolutions_EditThatClearsThePercentileSettlesItsFlag(t *testing.T) {
	percentile := parser.ScalarPath("rank_percentile")
	diamond, level := "diamond", 3
	for name, ud := range map[string]db.UserMatchData{
		"rank":  {MatchKey: "m1", Rank: &diamond},
		"level": {MatchKey: "m1", Level: &level},
	} {
		misread := 150
		rec := match.Record{
			MatchKey: "m1", SourceFiles: []string{"rank.png"},
			Data:       parser.MatchResult{RankPercentile: &misread},
			FieldFlags: []match.FieldFlag{openFlag(percentile, "150")},
		}
		recs := []match.Record{rec}
		aggregate.AttachUserData(recs, map[string]db.UserMatchData{"m1": ud})
		aggregate.AttachFieldResolutions(recs, nil)

		if recs[0].Data.RankPercentile != nil {
			t.Fatalf("%s edit: rank percentile = %d, want cleared", name, *recs[0].Data.RankPercentile)
		}
		if got := flagOn(t, recs[0], percentile).State; got != match.FlagEdited {
			t.Errorf("%s edit: state = %q, want edited", name, got)
		}
	}
}
