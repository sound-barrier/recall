package crosscheck_test

import (
	"testing"

	"recall/pkg/crosscheck"
	"recall/pkg/parser"
)

// A flag carries the value the folded match holds for its field now: the one
// stats use, which is the one a user confirms as read. It is read off the
// merged record, never off one screenshot, so it is the value on screen.

// alone is a match folded from one screenshot.
func alone(s crosscheck.Source) crosscheck.Group {
	return crosscheck.Group{Merged: s.Data, Sources: []crosscheck.Source{s}}
}

func requireValue(t *testing.T, g crosscheck.Group, field parser.FieldPath, want string) {
	t.Helper()
	flag, ok := flagFor(crosscheck.Flags(g), field)
	if !ok {
		t.Fatalf("no flag on %s", field)
	}
	if flag.Value != want {
		t.Errorf("flag on %s holds value %q, want %q", field, flag.Value, want)
	}
}

func TestFlagValue_ScalarStatIsTheMergedTotal(t *testing.T) {
	requireValue(t, alone(source(summaryFile, parser.TypeSummary, jpgSummary())), parser.ScalarPath("eliminations"), "74")
}

// The merged result, not either screenshot's: two sources disagree and the
// fold picked one.
func TestFlagValue_ResultIsTheOneTheFoldKept(t *testing.T) {
	summary := source(summaryFile, parser.TypeSummary, parser.MatchResult{Result: "defeat"})
	rank := source(rankFile, parser.TypeRank, parser.MatchResult{Result: "victory"})
	g := crosscheck.Group{Merged: parser.MatchResult{Result: "victory"}, Sources: []crosscheck.Source{summary, rank}}

	requireValue(t, g, parser.ScalarPath("result"), "victory")
}

func TestFlagValue_RankReadings(t *testing.T) {
	rank := parser.MatchResult{
		Level: 9, RankProgress: new(150), ChangePercent: new(-120), RankPercentile: new(140),
		SR: []parser.HeroSR{{Hero: "soldier 76", SR: 7000}},
	}
	g := alone(source(rankFile, parser.TypeRank, rank))

	requireValue(t, g, parser.ScalarPath("level"), "9")
	requireValue(t, g, parser.ScalarPath("rank_progress"), "150")
	requireValue(t, g, parser.ScalarPath("change_percent"), "-120")
	requireValue(t, g, parser.ScalarPath("rank_percentile"), "140")
	requireValue(t, g, parser.SRPath("soldier 76"), "7000")
}

func TestFlagValue_HeroPercentIsThatHeroesShare(t *testing.T) {
	summary := parser.MatchResult{HeroesPlayed: []parser.HeroPlay{
		{Hero: "d.va", PercentPlayed: 90}, {Hero: "mizuki", PercentPlayed: 33},
	}}
	g := alone(source(summaryFile, parser.TypeSummary, summary))

	requireValue(t, g, parser.HeroPercentPath("d.va"), "90")
	requireValue(t, g, parser.HeroPercentPath("mizuki"), "33")
}

// heroes_played is a list, so its value is the list as a reading spells one:
// hero keys joined by ", ".
func TestFlagValue_HeroListIsTheMergedList(t *testing.T) {
	summary := source(summaryFile, parser.TypeSummary, parser.MatchResult{HeroesPlayed: []parser.HeroPlay{
		{Hero: "juno", PercentPlayed: 67}, {Hero: "mizuki", PercentPlayed: 33},
	}})
	personal := source(personalFile, parser.TypePersonal, parser.MatchResult{Hero: "kiriko"})
	g := crosscheck.Group{Merged: summary.Data, Sources: []crosscheck.Source{summary, personal}}

	requireValue(t, g, parser.ScalarPath("heroes_played"), "juno, mizuki")
}
