package crosscheck_test

import (
	"image"
	"os"
	"slices"
	"testing"

	"gopkg.in/yaml.v3"

	"recall/pkg/crosscheck"
	"recall/pkg/match"
	"recall/pkg/parser"
)

const (
	summaryFile  = "summary.png"
	teamsFile    = "teams.png"
	personalFile = "personal.png"
	rankFile     = "rank.png"
)

func summaryPerf(e, a, d float64) *parser.Performance {
	return &parser.Performance{
		Eliminations: parser.PerformanceStat{AvgPer10Min: e},
		Assists:      parser.PerformanceStat{AvgPer10Min: a},
		Deaths:       parser.PerformanceStat{AvgPer10Min: d},
	}
}

// jpgSummary is the anchor misread: 74 eliminations where the card's own
// rate says 12.97 per 10 minutes over 06:56, which is 9. Assists and deaths
// agree with their rates exactly.
func jpgSummary() parser.MatchResult {
	return parser.MatchResult{
		Hero: "lucio", Eliminations: 74, Assists: 10, Deaths: 5,
		Result: "victory", GameLength: "15:45",
		HeroesPlayed: []parser.HeroPlay{{Hero: "lucio", PercentPlayed: 100, PlayTime: "06:56"}},
		Performance:  summaryPerf(12.97, 14.41, 7.21),
	}
}

// junoMizukiSummary is a clean SUMMARY from the corpus.
func junoMizukiSummary() parser.MatchResult {
	return parser.MatchResult{
		Hero: "juno", Eliminations: 9, Assists: 19, Deaths: 6,
		Result: "victory", GameLength: "14:56",
		HeroesPlayed: []parser.HeroPlay{
			{Hero: "juno", PercentPlayed: 67, PlayTime: "09:08"},
			{Hero: "mizuki", PercentPlayed: 33, PlayTime: "04:24"},
		},
		Performance: summaryPerf(6.64, 14.02, 4.43),
	}
}

func junoMizukiTeams() parser.MatchResult {
	return parser.MatchResult{Eliminations: 9, Assists: 19, Deaths: 6, Damage: 3514, Healing: 10933, Mitigation: 351, QueueType: "role"}
}

func junoMizukiRank() parser.MatchResult {
	return parser.MatchResult{
		Rank: "gold", Level: 2, Result: "victory", ChangePercent: new(26), RankProgress: new(83),
		Modifiers: []string{"expected", "victory"},
		SR:        []parser.HeroSR{{Hero: "juno", SR: 2389, Change: new(31)}, {Hero: "mizuki", SR: 2481}},
	}
}

func source(file string, t parser.ScreenshotType, data parser.MatchResult, evidence ...parser.FieldEvidence) crosscheck.Source {
	return crosscheck.Source{File: file, Type: t, Data: data, Evidence: evidence}
}

// groupOf folds sources the simple way the checks care about: the first
// non-empty reading of each field wins, in source order.
func groupOf(sources ...crosscheck.Source) crosscheck.Group {
	var merged parser.MatchResult
	for _, s := range sources {
		mergeFirst(&merged, s.Data)
	}
	return crosscheck.Group{Merged: merged, Sources: sources}
}

func mergeFirst(dst *parser.MatchResult, src parser.MatchResult) {
	for _, pair := range []struct{ dst, src *int }{
		{&dst.Eliminations, &src.Eliminations}, {&dst.Assists, &src.Assists}, {&dst.Deaths, &src.Deaths},
		{&dst.Damage, &src.Damage}, {&dst.Healing, &src.Healing}, {&dst.Mitigation, &src.Mitigation},
	} {
		if *pair.dst == 0 {
			*pair.dst = *pair.src
		}
	}
	if dst.Result == "" {
		dst.Result = src.Result
	}
	if dst.GameLength == "" {
		dst.GameLength = src.GameLength
	}
	if dst.ChangePercent == nil {
		dst.ChangePercent = src.ChangePercent
	}
	if len(dst.Modifiers) == 0 {
		dst.Modifiers = src.Modifiers
	}
	dst.HeroesPlayed = append(dst.HeroesPlayed, src.HeroesPlayed...)
}

func templateAt(field parser.FieldPath, value string) parser.FieldEvidence {
	return parser.FieldEvidence{
		Field: field, Rect: image.Rect(10, 10, 40, 30),
		Template: &parser.TemplateReading{Value: value, Score: 0.97, Margin: 0.2},
	}
}

func regionAt(field parser.FieldPath) parser.FieldEvidence {
	return parser.FieldEvidence{Field: field, Rect: image.Rect(10, 10, 40, 30)}
}

func flagFor(flags []match.FieldFlag, field parser.FieldPath) (match.FieldFlag, bool) {
	i := slices.IndexFunc(flags, func(f match.FieldFlag) bool { return f.Field == field })
	if i < 0 {
		return match.FieldFlag{}, false
	}
	return flags[i], true
}

func requireFlag(t *testing.T, flags []match.FieldFlag, field parser.FieldPath, check match.CheckID) match.FieldFlag {
	t.Helper()
	flag, ok := flagFor(flags, field)
	if !ok {
		t.Fatalf("no flag on %s; flags = %+v", field, flags)
	}
	if !slices.Contains(flag.Checks, check) {
		t.Fatalf("flag on %s lists checks %v, want %s among them", field, flag.Checks, check)
	}
	if flag.State != match.FlagOpen {
		t.Errorf("flag on %s is %q, want open", field, flag.State)
	}
	return flag
}

func requireReading(t *testing.T, flag match.FieldFlag, want match.FieldReading) {
	t.Helper()
	if !slices.Contains(flag.Readings, want) {
		t.Errorf("flag on %s has readings %+v, want %+v among them", flag.Field, flag.Readings, want)
	}
}

func requireNoFlags(t *testing.T, flags []match.FieldFlag) {
	t.Helper()
	if len(flags) != 0 {
		t.Errorf("want no flags, got %+v", flags)
	}
}

func requireNoFlagOn(t *testing.T, flags []match.FieldFlag, field parser.FieldPath) {
	t.Helper()
	if flag, ok := flagFor(flags, field); ok {
		t.Errorf("want no flag on %s, got %+v", field, flag)
	}
}

func TestFlags_SummaryOverReadFlagsEliminationsWithItsDerivedValue(t *testing.T) {
	flags := crosscheck.Flags(groupOf(source(summaryFile, parser.TypeSummary, jpgSummary())))

	flag := requireFlag(t, flags, parser.ScalarPath("eliminations"), match.CheckPerfTotalVsRate)
	requireReading(t, flag, match.FieldReading{SourceFile: summaryFile, Origin: match.OriginOCR, Value: "74"})
	requireReading(t, flag, match.FieldReading{SourceFile: summaryFile, Origin: match.OriginDerived, Value: "9"})
	requireNoFlagOn(t, flags, parser.ScalarPath("assists"))
	requireNoFlagOn(t, flags, parser.ScalarPath("deaths"))
	if len(flags) != 1 {
		t.Errorf("want only the eliminations flag, got %+v", flags)
	}
}

func TestFlags_CleanMatchRaisesNothing(t *testing.T) {
	junoStat := parser.FieldEvidence{Field: parser.ScalarPath("eliminations"), Rect: image.Rect(1, 1, 9, 9), Template: &parser.TemplateReading{Value: "9", Score: 0.95, Margin: 0.3}}
	g := groupOf(
		source(summaryFile, parser.TypeSummary, junoMizukiSummary(), templateAt(parser.ScalarPath("deaths"), "6")),
		source(teamsFile, parser.TypeTeams, junoMizukiTeams(), junoStat),
		source(personalFile, parser.TypePersonal, parser.MatchResult{Hero: "juno"}),
		source(rankFile, parser.TypeRank, junoMizukiRank(), templateAt(parser.SRPath("juno"), "2389")),
	)

	requireNoFlags(t, crosscheck.Flags(g))
}

func TestFlags_ThreeHeroSummaryRaisesNothing(t *testing.T) {
	summary := parser.MatchResult{
		Eliminations: 11, Assists: 12, Deaths: 3, GameLength: "7:39",
		HeroesPlayed: []parser.HeroPlay{
			{Hero: "baptiste", PercentPlayed: 51, PlayTime: "03:54"},
			{Hero: "junkrat", PercentPlayed: 29, PlayTime: "02:11"},
			{Hero: "reinhardt", PercentPlayed: 20, PlayTime: "01:32"},
		},
		Performance: summaryPerf(14.38, 15.69, 3.92),
	}

	requireNoFlags(t, crosscheck.Flags(groupOf(source(summaryFile, parser.TypeSummary, summary))))
}

func TestFlags_OneFlagPerFieldListsEveryCheckThatFired(t *testing.T) {
	g := groupOf(source(summaryFile, parser.TypeSummary, jpgSummary(), templateAt(parser.ScalarPath("eliminations"), "9")))

	flags := crosscheck.Flags(g)

	if len(flags) != 1 {
		t.Fatalf("want one flag, got %+v", flags)
	}
	want := []match.CheckID{match.CheckPerfTotalVsRate, match.CheckTemplateDisagreement}
	if !slices.Equal(flags[0].Checks, want) {
		t.Errorf("checks = %v, want %v", flags[0].Checks, want)
	}
	requireReading(t, flags[0], match.FieldReading{SourceFile: summaryFile, Origin: match.OriginTemplate, Value: "9"})
	ocrReadings := 0
	for _, r := range flags[0].Readings {
		if r.Origin == match.OriginOCR {
			ocrReadings++
		}
	}
	if ocrReadings != 1 {
		t.Errorf("the OCR reading should appear once however many checks name it; readings = %+v", flags[0].Readings)
	}
}

func TestFlags_SortedByField(t *testing.T) {
	teams := parser.MatchResult{Eliminations: 200, Deaths: 90, Damage: 200_000}

	flags := crosscheck.Flags(groupOf(source(teamsFile, parser.TypeTeams, teams)))

	fields := make([]string, 0, len(flags))
	for _, f := range flags {
		fields = append(fields, string(f.Field))
	}
	if len(fields) != 3 || !slices.IsSorted(fields) {
		t.Errorf("fields = %v, want three, sorted", fields)
	}
}

// publishedEnum is the enum the OpenAPI spec publishes under schema, sorted.
func publishedEnum(t *testing.T, schema string) []string {
	t.Helper()
	raw, err := os.ReadFile("../../api/openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	var spec struct {
		Components struct {
			Schemas map[string]struct {
				Enum []string `yaml:"enum"`
			} `yaml:"schemas"`
		} `yaml:"components"`
	}
	if err := yaml.Unmarshal(raw, &spec); err != nil {
		t.Fatal(err)
	}
	published := spec.Components.Schemas[schema].Enum
	if len(published) == 0 {
		t.Fatalf("api/openapi.yaml publishes no enum %s", schema)
	}
	return slices.Sorted(slices.Values(published))
}

// TestRegistry_CoversTheAPIEnum holds the check registry and the published
// FieldCheckEnum to one set. The registry is a map, so a check added to one
// and not the other gets no exhaustive-switch error; this is that error.
func TestRegistry_CoversTheAPIEnum(t *testing.T) {
	registered := make([]string, 0, len(crosscheck.RegisteredChecks()))
	for _, id := range crosscheck.RegisteredChecks() {
		registered = append(registered, string(id))
	}
	if published := publishedEnum(t, "FieldCheckEnum"); !slices.Equal(registered, published) {
		t.Errorf("registered checks %v, FieldCheckEnum %v: add the check to both", registered, published)
	}
}

// TestFlagEnums_MatchTheAPI holds every state and origin a flag can carry to
// the enum the API publishes for it, so a typo in either a Go value or the
// spec fails here rather than in a client that never sees that value.
func TestFlagEnums_MatchTheAPI(t *testing.T) {
	states := sortedStrings(match.FlagOpen, match.FlagConfirmed, match.FlagEdited)
	if published := publishedEnum(t, "FieldFlagStateEnum"); !slices.Equal(states, published) {
		t.Errorf("flag states %v, FieldFlagStateEnum %v", states, published)
	}
	origins := sortedStrings(match.OriginOCR, match.OriginTemplate, match.OriginDerived)
	if published := publishedEnum(t, "FieldReadingOriginEnum"); !slices.Equal(origins, published) {
		t.Errorf("reading origins %v, FieldReadingOriginEnum %v", origins, published)
	}
}

func sortedStrings[S ~string](values ...S) []string {
	out := make([]string, 0, len(values))
	for _, v := range values {
		out = append(out, string(v))
	}
	slices.Sort(out)
	return out
}
