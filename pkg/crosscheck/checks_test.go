package crosscheck_test

import (
	"testing"

	"recall/pkg/crosscheck"
	"recall/pkg/match"
	"recall/pkg/parser"
)

// boundaryCase is one reading on either side of a check's threshold.
type boundaryCase struct {
	name    string
	group   crosscheck.Group
	field   parser.FieldPath
	flagged bool
}

func runBoundaries(t *testing.T, check match.CheckID, cases []boundaryCase) {
	t.Helper()
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			flags := crosscheck.Flags(tc.group)
			if tc.flagged {
				requireFlag(t, flags, tc.field, check)
				return
			}
			requireNoFlagOn(t, flags, tc.field)
		})
	}
}

// tenMinuteSummary plays one hero for 10:00, so each total is expected to
// equal its rate.
func tenMinuteSummary(e int, eRate float64, playTime string) crosscheck.Group {
	return groupOf(source(summaryFile, parser.TypeSummary, parser.MatchResult{
		Eliminations: e, Assists: 10, Deaths: 5,
		HeroesPlayed: []parser.HeroPlay{{Hero: "lucio", PercentPlayed: 100, PlayTime: playTime}},
		Performance:  summaryPerf(eRate, 10, 5),
	}))
}

func TestPerfTotalVsRate_Boundaries(t *testing.T) {
	elims := parser.ScalarPath("eliminations")
	runBoundaries(t, match.CheckPerfTotalVsRate, []boundaryCase{
		{"two off a small total is rounding", tenMinuteSummary(12, 10, "10:00"), elims, false},
		{"three off a small total", tenMinuteSummary(13, 10, "10:00"), elims, true},
		{"15% off a large total is rounding", tenMinuteSummary(34, 30, "10:00"), elims, false},
		{"over 15% off a large total", tenMinuteSummary(35, 30, "10:00"), elims, true},
		{"under a minute played says nothing", tenMinuteSummary(50, 10, "00:59"), elims, false},
		{"no rate says nothing", tenMinuteSummary(50, 0, "10:00"), elims, false},
		{"no play time says nothing", tenMinuteSummary(50, 10, ""), elims, false},
	})
}

// listedSummary plays heroes whose percents sum to listed over 10:00, all of
// the play time on the first card. Eliminations read 13 at 10 per 10 minutes
// (three off, so flagged when judged); assists and deaths agree with their
// rates, so the every-card-disagrees escape never applies.
func listedSummary(percents ...int) crosscheck.Group {
	heroes := []string{"juno", "mizuki", "kiriko"}
	var played []parser.HeroPlay
	for i, pct := range percents {
		played = append(played, parser.HeroPlay{Hero: heroes[i], PercentPlayed: pct, PlayTime: "00:00"})
	}
	played[0].PlayTime = "10:00"
	return groupOf(source(summaryFile, parser.TypeSummary, parser.MatchResult{
		Eliminations: 13, Assists: 10, Deaths: 5,
		HeroesPlayed: played, Performance: summaryPerf(10, 10, 5),
	}))
}

// TestPerfTotalVsRate_JudgesOnlyACompleteHeroList: the minutes played are the
// listed cards' play time, so a list missing a hero understates them and
// condemns correct totals. A percent sum short of 100 by more than a point of
// rounding per hero says a hero has no card, the same line the percent check
// draws.
func TestPerfTotalVsRate_JudgesOnlyACompleteHeroList(t *testing.T) {
	elims := parser.ScalarPath("eliminations")
	runBoundaries(t, match.CheckPerfTotalVsRate, []boundaryCase{
		{"one hero at 99% is the whole match", listedSummary(99), elims, true},
		{"one hero at 98% left a hero out", listedSummary(98), elims, false},
		{"three heroes at 97% are the whole match", listedSummary(95, 1, 1), elims, true},
		{"three heroes at 80% left a hero out", listedSummary(60, 10, 10), elims, false},
		{"unread percents cannot vouch for the list", listedSummary(0), elims, false},
	})
}

// TestPerfTotalVsRate_DroppedHeroCardFlagsNothing is the case the guard
// exists for: Juno at 60% over 09:00 beside a 40% hero whose card the parser
// could not name. Every total is right over the whole 15 minutes, but over
// Juno's 9 alone eliminations and assists look inflated while deaths, small
// enough to sit inside the rounding floor, agree.
func TestPerfTotalVsRate_DroppedHeroCardFlagsNothing(t *testing.T) {
	summary := parser.MatchResult{
		Eliminations: 20, Assists: 25, Deaths: 4,
		HeroesPlayed: []parser.HeroPlay{{Hero: "juno", PercentPlayed: 60, PlayTime: "09:00"}},
		Performance:  summaryPerf(13.33, 16.67, 2.67),
	}

	requireNoFlags(t, crosscheck.Flags(groupOf(source(summaryFile, parser.TypeSummary, summary))))
}

// TestPerfTotalVsRate_UnreadTotalIsNoReading: a card whose average was read
// but whose total was not leaves the 0 nothing read, and the parse records no
// region for it; that 0 is not a reading to hold against the rate. A 0 the
// pixels produced is.
func TestPerfTotalVsRate_UnreadTotalIsNoReading(t *testing.T) {
	elims := parser.ScalarPath("eliminations")
	unreadTotal := func(evidence ...parser.FieldEvidence) crosscheck.Group {
		summary := jpgSummary()
		summary.Eliminations = 0
		return groupOf(source(summaryFile, parser.TypeSummary, summary, evidence...))
	}
	runBoundaries(t, match.CheckPerfTotalVsRate, []boundaryCase{
		{"a total nothing read", unreadTotal(), elims, false},
		{"a 0 the pixels produced", unreadTotal(regionAt(elims)), elims, true},
	})
}

// TestPerfTotalVsRate_MisreadPlayTimeFlagsNoTotal: the three cards share the
// minutes played, so when every card disagrees with the play time by the same
// factor it is the play time that is wrong, not three totals at once.
func TestPerfTotalVsRate_MisreadPlayTimeFlagsNoTotal(t *testing.T) {
	summary := parser.MatchResult{
		Eliminations: 20, Assists: 30, Deaths: 10,
		HeroesPlayed: []parser.HeroPlay{{Hero: "lucio", PercentPlayed: 100, PlayTime: "05:00"}},
		Performance:  summaryPerf(10, 15, 5),
	}

	requireNoFlags(t, crosscheck.Flags(groupOf(source(summaryFile, parser.TypeSummary, summary))))
}

// TestWithoutDisownedTotals_ClearsOnlyACondemnedTotal: the view leaves
// unread exactly the total perf_total_vs_rate flags, and keeps every reading
// the check does not condemn as it was read. It does not put the rate's total
// in its place: the check cannot tell a misread total from a misread rate.
func TestWithoutDisownedTotals_ClearsOnlyACondemnedTotal(t *testing.T) {
	playTimeMisread := parser.MatchResult{
		Eliminations: 20, Assists: 30, Deaths: 10,
		HeroesPlayed: []parser.HeroPlay{{Hero: "lucio", PercentPlayed: 100, PlayTime: "05:00"}},
		Performance:  summaryPerf(10, 15, 5),
	}
	cases := []struct {
		name    string
		source  crosscheck.Source
		e, a, d int
	}{
		{"the condemned total is left unread", source(summaryFile, parser.TypeSummary, jpgSummary()), 0, 10, 5},
		{"a misread play time condemns no total", source(summaryFile, parser.TypeSummary, playTimeMisread), 20, 30, 10},
		{"only a SUMMARY is held to its rates", source(teamsFile, parser.TypeTeams, jpgSummary()), 74, 10, 5},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := crosscheck.WithoutDisownedTotals(tc.source)
			if got.Eliminations != tc.e || got.Assists != tc.a || got.Deaths != tc.d {
				t.Errorf("E/A/D = %d/%d/%d, want %d/%d/%d", got.Eliminations, got.Assists, got.Deaths, tc.e, tc.a, tc.d)
			}
		})
	}
}

// TestWithoutDisownedTotals_LeavesTheReadingAlone: the view is a copy; the
// source's own reading still says what the pixels said.
func TestWithoutDisownedTotals_LeavesTheReadingAlone(t *testing.T) {
	s := source(summaryFile, parser.TypeSummary, jpgSummary())
	_ = crosscheck.WithoutDisownedTotals(s)
	if s.Data.Eliminations != 74 {
		t.Errorf("source eliminations = %d, want the 74 as read", s.Data.Eliminations)
	}
}

func twoHeroSummary(juno, mizuki int, junoTime, mizukiTime string) crosscheck.Group {
	return groupOf(source(summaryFile, parser.TypeSummary, parser.MatchResult{
		HeroesPlayed: []parser.HeroPlay{
			{Hero: "juno", PercentPlayed: juno, PlayTime: junoTime},
			{Hero: "mizuki", PercentPlayed: mizuki, PlayTime: mizukiTime},
		},
	}))
}

func TestHeroPercentVsPlaytime_Boundaries(t *testing.T) {
	juno, mizuki := parser.HeroPercentPath("juno"), parser.HeroPercentPath("mizuki")
	runBoundaries(t, match.CheckHeroPercentVsPlaytime, []boundaryCase{
		{"three points off is rounding", twoHeroSummary(63, 37, "06:00", "04:00"), juno, false},
		{"four points off", twoHeroSummary(64, 38, "06:00", "04:00"), juno, true},
		{"the hero within three points stays clean", twoHeroSummary(64, 38, "06:00", "04:00"), mizuki, false},
		{"a sum over 100 plus one per hero", twoHeroSummary(70, 33, "", ""), juno, true},
		{"a sum over 100 flags every hero", twoHeroSummary(70, 33, "", ""), mizuki, true},
		{"a sum of 100 plus one per hero is rounding", twoHeroSummary(70, 32, "", ""), juno, false},
		{"a sum short of 100 is deferred", twoHeroSummary(50, 20, "06:00", "04:00"), juno, false},
		{"a hero without a time skips the split", twoHeroSummary(90, 10, "06:00", ""), juno, false},
	})
}

// TestHeroPercentVsPlaytime_UnnamedCardFlagsNoPath: a card with no hero name
// has no path a flag could name, so it is never flagged; its play time still
// counts toward the total the named cards are held to.
func TestHeroPercentVsPlaytime_UnnamedCardFlagsNoPath(t *testing.T) {
	unnamed := parser.HeroPercentPath("")
	summaryOf := func(heroes ...parser.HeroPlay) crosscheck.Group {
		return groupOf(source(summaryFile, parser.TypeSummary, parser.MatchResult{HeroesPlayed: heroes}))
	}
	offItsTime := summaryOf(parser.HeroPlay{PercentPlayed: 30, PlayTime: "03:00"}, parser.HeroPlay{Hero: "juno", PercentPlayed: 70, PlayTime: "04:00"})
	overHundred := summaryOf(parser.HeroPlay{PercentPlayed: 60}, parser.HeroPlay{Hero: "juno", PercentPlayed: 60})
	runBoundaries(t, match.CheckHeroPercentVsPlaytime, []boundaryCase{
		{"an unnamed card off its time", offItsTime, unnamed, false},
		{"the named card beside it is still judged", offItsTime, parser.HeroPercentPath("juno"), true},
		{"an unnamed card in a sum over 100", overHundred, unnamed, false},
		{"the named card in that sum", overHundred, parser.HeroPercentPath("juno"), true},
	})
}

func rankGroup(result string, change *int, modifiers ...string) crosscheck.Group {
	return groupOf(source(rankFile, parser.TypeRank, parser.MatchResult{Result: result, ChangePercent: change, Modifiers: modifiers}))
}

func TestResultVsRankMovement_Boundaries(t *testing.T) {
	result := parser.ScalarPath("result")
	runBoundaries(t, match.CheckResultVsRankMovement, []boundaryCase{
		{"victory that lost rank", rankGroup("victory", new(-10)), result, true},
		{"victory that gained rank", rankGroup("victory", new(10)), result, false},
		{"defeat that gained rank", rankGroup("defeat", new(10)), result, true},
		{"defeat that lost rank", rankGroup("defeat", new(-10)), result, false},
		{"a move of nothing says nothing", rankGroup("defeat", new(0)), result, false},
		{"an unread move says nothing", rankGroup("victory", nil), result, false},
		{"a draw says nothing", rankGroup("draw", new(-10)), result, false},
		{"victory under a reversal pill", rankGroup("victory", nil, "reversal"), result, true},
		{"victory under a consolation pill", rankGroup("victory", nil, "consolation"), result, true},
		{"defeat under an expected pill", rankGroup("defeat", nil, "expected"), result, true},
		{"defeat under an uphill battle pill", rankGroup("defeat", nil, "uphill battle"), result, true},
		{"defeat under a demotion protection pill", rankGroup("defeat", nil, "consolation", "demotion protection"), result, false},
		{"victory under its streak pill", rankGroup("victory", nil, "winning trend", "variance"), result, false},
	})
}

func TestResultVsRankMovement_DerivesTheResultTheMovementImplies(t *testing.T) {
	g := groupOf(
		source(summaryFile, parser.TypeSummary, parser.MatchResult{Result: "victory"}),
		source(rankFile, parser.TypeRank, parser.MatchResult{ChangePercent: new(-25)}),
	)

	flag := requireFlag(t, crosscheck.Flags(g), parser.ScalarPath("result"), match.CheckResultVsRankMovement)
	requireReading(t, flag, match.FieldReading{SourceFile: summaryFile, Origin: match.OriginOCR, Value: "victory"})
	requireReading(t, flag, match.FieldReading{SourceFile: rankFile, Origin: match.OriginDerived, Value: "defeat"})
}

func TestPlausibleRange_Boundaries(t *testing.T) {
	teams := func(d parser.MatchResult) crosscheck.Group { return groupOf(source(teamsFile, parser.TypeTeams, d)) }
	rank := func(d parser.MatchResult) crosscheck.Group { return groupOf(source(rankFile, parser.TypeRank, d)) }
	runBoundaries(t, match.CheckPlausibleRange, []boundaryCase{
		{"150 eliminations", teams(parser.MatchResult{Eliminations: 150}), parser.ScalarPath("eliminations"), false},
		{"151 eliminations", teams(parser.MatchResult{Eliminations: 151}), parser.ScalarPath("eliminations"), true},
		{"151 assists", teams(parser.MatchResult{Assists: 151}), parser.ScalarPath("assists"), true},
		{"80 deaths", teams(parser.MatchResult{Deaths: 80}), parser.ScalarPath("deaths"), false},
		{"81 deaths", teams(parser.MatchResult{Deaths: 81}), parser.ScalarPath("deaths"), true},
		{"100k damage", teams(parser.MatchResult{Damage: 100_000}), parser.ScalarPath("damage"), false},
		{"over 100k damage", teams(parser.MatchResult{Damage: 100_001}), parser.ScalarPath("damage"), true},
		{"over 100k healing", teams(parser.MatchResult{Healing: 100_001}), parser.ScalarPath("healing"), true},
		{"150k mitigation", teams(parser.MatchResult{Mitigation: 150_000}), parser.ScalarPath("mitigation"), false},
		{"over 150k mitigation", teams(parser.MatchResult{Mitigation: 150_001}), parser.ScalarPath("mitigation"), true},
		{"SR 6000", rank(parser.MatchResult{SR: []parser.HeroSR{{Hero: "juno", SR: 6000}}}), parser.SRPath("juno"), false},
		{"SR 6001", rank(parser.MatchResult{SR: []parser.HeroSR{{Hero: "juno", SR: 6001}}}), parser.SRPath("juno"), true},
		{"level 5", rank(parser.MatchResult{Level: 5}), parser.ScalarPath("level"), false},
		{"level 6", rank(parser.MatchResult{Level: 6}), parser.ScalarPath("level"), true},
		{"a 100% move", rank(parser.MatchResult{ChangePercent: new(-100)}), parser.ScalarPath("change_percent"), false},
		{"a 101% move", rank(parser.MatchResult{ChangePercent: new(101)}), parser.ScalarPath("change_percent"), true},
		{"progress below the division", rank(parser.MatchResult{RankProgress: new(-19)}), parser.ScalarPath("rank_progress"), false},
		{"progress past 100%", rank(parser.MatchResult{RankProgress: new(101)}), parser.ScalarPath("rank_progress"), true},
		{"a percentile past 100%", rank(parser.MatchResult{RankPercentile: new(101)}), parser.ScalarPath("rank_percentile"), true},
	})
}

// teamsBesideSummary pairs a TEAMS reading with a SUMMARY that says how long
// the match ran, which is what the per-10-minute caps need.
func teamsBesideSummary(teams parser.MatchResult, gameLength string) crosscheck.Group {
	return groupOf(
		source(teamsFile, parser.TypeTeams, teams),
		source(summaryFile, parser.TypeSummary, parser.MatchResult{GameLength: gameLength}),
	)
}

func TestPlausibleRange_PerTenMinuteCaps(t *testing.T) {
	elims, damage := parser.ScalarPath("eliminations"), parser.ScalarPath("damage")
	runBoundaries(t, match.CheckPlausibleRange, []boundaryCase{
		{"60 eliminations in 10 minutes", teamsBesideSummary(parser.MatchResult{Eliminations: 60}, "10:00"), elims, false},
		{"61 eliminations in 10 minutes", teamsBesideSummary(parser.MatchResult{Eliminations: 61}, "10:00"), elims, true},
		{"40k damage in 10 minutes", teamsBesideSummary(parser.MatchResult{Damage: 40_000}, "10:00"), damage, false},
		{"over 40k damage in 10 minutes", teamsBesideSummary(parser.MatchResult{Damage: 40_001}, "10:00"), damage, true},
		{"a short match takes no rate cap", teamsBesideSummary(parser.MatchResult{Eliminations: 61}, "4:59"), elims, false},
	})
}
