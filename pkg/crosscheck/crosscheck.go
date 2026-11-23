// Package crosscheck notices when a match's readings disagree with each other:
// a SUMMARY total its own rate contradicts, two screenshots of one match
// reading one fact differently, a value no match can produce, the reference
// templates reading the same pixels as something else. It never decides which
// reading is right. Each disagreement becomes a flag on the field, carrying
// every reading compared, for the user to judge against the pixels.
package crosscheck

import (
	"maps"
	"slices"
	"strings"

	"recall/pkg/match"
	"recall/pkg/parser"
)

// Source is one screenshot's own reading of a match, before the fold picked
// one value per field: the checks compare readings, so they need each
// screenshot's, not only the winner.
type Source struct {
	File     string
	Type     parser.ScreenshotType
	Data     parser.MatchResult
	Evidence []parser.FieldEvidence
}

// Group is one match: the record the fold produced and the screenshots it
// was folded from.
type Group struct {
	Merged  parser.MatchResult
	Sources []Source
}

// finding is one check's word on one field: the readings that disagree.
type finding struct {
	field    parser.FieldPath
	readings []match.FieldReading
}

// check is one cross-check over a whole match.
type check func(Group) []finding

// registry holds every check by the ID the API publishes. A map keyed by the
// discriminant rather than a switch, so a new check is one entry; the
// completeness test holds it to FieldCheckEnum, since a map loses the
// exhaustive-switch error.
var registry = map[match.CheckID]check{
	match.CheckPerfTotalVsRate:       perfTotalVsRate,
	match.CheckHeroPercentVsPlaytime: heroPercentVsPlaytime,
	match.CheckResultVsRankMovement:  resultVsRankMovement,
	match.CheckSourceDisagreement:    sourceDisagreement,
	match.CheckPlausibleRange:        plausibleRange,
	match.CheckTemplateDisagreement:  templateDisagreement,
}

func registeredChecks() []match.CheckID {
	return slices.Sorted(maps.Keys(registry))
}

// Flags runs every check over g: one open flag per field that any check
// found, listing every check that fired and every reading compared, each
// once. Sorted by field; nil when the readings agree.
func Flags(g Group) []match.FieldFlag {
	byField := map[parser.FieldPath]*match.FieldFlag{}
	for _, id := range registeredChecks() {
		for _, f := range registry[id](g) {
			addFinding(byField, id, f)
		}
	}
	if len(byField) == 0 {
		return nil
	}
	out := make([]match.FieldFlag, 0, len(byField))
	for _, flag := range byField {
		out = append(out, *flag)
	}
	slices.SortFunc(out, func(a, b match.FieldFlag) int { return strings.Compare(string(a.Field), string(b.Field)) })
	return out
}

func addFinding(byField map[parser.FieldPath]*match.FieldFlag, id match.CheckID, f finding) {
	flag, ok := byField[f.field]
	if !ok {
		flag = &match.FieldFlag{Field: f.field, State: match.FlagOpen}
		byField[f.field] = flag
	}
	if !slices.Contains(flag.Checks, id) {
		flag.Checks = append(flag.Checks, id)
	}
	for _, r := range f.readings {
		if !slices.Contains(flag.Readings, r) {
			flag.Readings = append(flag.Readings, r)
		}
	}
}
