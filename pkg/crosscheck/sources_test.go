package crosscheck_test

import (
	"testing"

	"recall/pkg/crosscheck"
	"recall/pkg/match"
	"recall/pkg/parser"
)

func TestSourceDisagreement_SummaryAndTeamsEliminations(t *testing.T) {
	summary := junoMizukiSummary()
	summary.Eliminations = 74
	summary.Performance = nil // only the two sources disagree, not the card with itself
	g := groupOf(source(summaryFile, parser.TypeSummary, summary), source(teamsFile, parser.TypeTeams, junoMizukiTeams()))

	flag := requireFlag(t, crosscheck.Flags(g), parser.ScalarPath("eliminations"), match.CheckSourceDisagreement)
	requireReading(t, flag, match.FieldReading{SourceFile: summaryFile, Origin: match.OriginOCR, Value: "74"})
	requireReading(t, flag, match.FieldReading{SourceFile: teamsFile, Origin: match.OriginOCR, Value: "9"})
}

func TestSourceDisagreement_Boundaries(t *testing.T) {
	deaths := parser.ScalarPath("deaths")
	unreadTeams := parser.MatchResult{Eliminations: 9, Assists: 19}
	summaryBeside := func(teams parser.MatchResult, evidence ...parser.FieldEvidence) crosscheck.Group {
		return groupOf(
			source(summaryFile, parser.TypeSummary, parser.MatchResult{Eliminations: 9, Assists: 19, Deaths: 6}),
			source(teamsFile, parser.TypeTeams, teams, evidence...),
		)
	}
	runBoundaries(t, match.CheckSourceDisagreement, []boundaryCase{
		{"a 0 nothing read is no reading", summaryBeside(unreadTeams), deaths, false},
		{"a 0 the pixels produced is a reading", summaryBeside(unreadTeams, regionAt(deaths)), deaths, true},
		{"one screenshot cannot disagree with itself", groupOf(source(teamsFile, parser.TypeTeams, junoMizukiTeams())), deaths, false},
	})
}

func TestSourceDisagreement_SummaryAndRankResult(t *testing.T) {
	g := groupOf(
		source(summaryFile, parser.TypeSummary, parser.MatchResult{Result: "victory"}),
		source(rankFile, parser.TypeRank, parser.MatchResult{Result: "defeat"}),
	)

	flag := requireFlag(t, crosscheck.Flags(g), parser.ScalarPath("result"), match.CheckSourceDisagreement)
	requireReading(t, flag, match.FieldReading{SourceFile: summaryFile, Origin: match.OriginOCR, Value: "victory"})
	requireReading(t, flag, match.FieldReading{SourceFile: rankFile, Origin: match.OriginOCR, Value: "defeat"})
}

func TestSourceDisagreement_HeroOutsideHeroesPlayed(t *testing.T) {
	heroes := parser.ScalarPath("heroes_played")
	summary := source(summaryFile, parser.TypeSummary, junoMizukiSummary())
	withSummary := func(other crosscheck.Source) crosscheck.Group { return groupOf(summary, other) }
	rankOn := func(hero string) crosscheck.Source {
		return source(rankFile, parser.TypeRank, parser.MatchResult{SR: []parser.HeroSR{{Hero: hero, SR: 2400}}})
	}
	runBoundaries(t, match.CheckSourceDisagreement, []boundaryCase{
		{"a PERSONAL hero the SUMMARY lists", withSummary(source(personalFile, parser.TypePersonal, parser.MatchResult{Hero: "mizuki"})), heroes, false},
		{"a PERSONAL hero the SUMMARY lacks", withSummary(source(personalFile, parser.TypePersonal, parser.MatchResult{Hero: "ana"})), heroes, true},
		{"a rank card hero the SUMMARY lists", withSummary(rankOn("juno")), heroes, false},
		{"a rank card hero the SUMMARY lacks", withSummary(rankOn("ana")), heroes, true},
		{"a rank card whose hero was not read", withSummary(rankOn("")), heroes, false},
		{"no SUMMARY, no list to hold it to", groupOf(source(personalFile, parser.TypePersonal, parser.MatchResult{Hero: "ana"})), heroes, false},
	})
}

func TestTemplateDisagreement_Boundaries(t *testing.T) {
	elims, deaths := parser.ScalarPath("eliminations"), parser.ScalarPath("deaths")
	teamsWith := func(evidence ...parser.FieldEvidence) crosscheck.Group {
		return groupOf(source(teamsFile, parser.TypeTeams, junoMizukiTeams(), evidence...))
	}
	rankWith := func(evidence parser.FieldEvidence) crosscheck.Group {
		return groupOf(source(rankFile, parser.TypeRank, junoMizukiRank(), evidence))
	}
	summaryWith := func(evidence parser.FieldEvidence) crosscheck.Group {
		return groupOf(source(summaryFile, parser.TypeSummary, junoMizukiSummary(), evidence))
	}
	runBoundaries(t, match.CheckTemplateDisagreement, []boundaryCase{
		{"the templates agree", teamsWith(templateAt(elims, "9")), elims, false},
		{"the templates read another number", teamsWith(templateAt(elims, "19")), elims, true},
		{"no reference matched", teamsWith(regionAt(elims)), elims, false},
		{"rank SR the templates agree with", rankWith(templateAt(parser.SRPath("juno"), "2389")), parser.SRPath("juno"), false},
		{"rank SR the templates read otherwise", rankWith(templateAt(parser.SRPath("juno"), "2339")), parser.SRPath("juno"), true},
		{"a SUMMARY total the templates agree with", summaryWith(templateAt(deaths, "6")), deaths, false},
		{"a SUMMARY total the templates read otherwise", summaryWith(templateAt(deaths, "8")), deaths, true},
	})
}
