package crosscheck

import (
	"slices"

	"recall/pkg/match"
	"recall/pkg/parser"
)

const (
	victory = "victory"
	defeat  = "defeat"
)

// resultPills are the rank-screen pills only one result can carry: the
// expectation quartet (favored or underdog, won or lost) and the result pill
// itself. Streak, calibration and condition pills ride either result.
var resultPills = map[string][]string{
	victory: {"expected", "uphill battle", victory},
	defeat:  {"reversal", "consolation", defeat},
}

// resultVsRankMovement holds a victory or defeat to what each rank screen of
// the match says happened: the rank's movement and its result-bound pills.
// A draw moves the rank either way, and an unread or zero movement says
// nothing. The result the contradiction implies rides along as a reading.
func resultVsRankMovement(g Group) []finding {
	result := g.Merged.Result
	opposite, decisive := oppositeResult(result)
	if !decisive {
		return nil
	}
	var implied []match.FieldReading
	for _, s := range g.Sources {
		if s.Type == parser.TypeRank && contradicts(s.Data, result) {
			implied = append(implied, match.FieldReading{SourceFile: s.File, Origin: match.OriginDerived, Value: opposite})
		}
	}
	if len(implied) == 0 {
		return nil
	}
	return []finding{{field: parser.ScalarPath("result"), readings: append(resultReadings(g), implied...)}}
}

func oppositeResult(result string) (string, bool) {
	switch result {
	case victory:
		return defeat, true
	case defeat:
		return victory, true
	}
	return "", false
}

// contradicts reports whether a rank screen's movement or pills say the
// match ended the other way.
func contradicts(rank parser.MatchResult, result string) bool {
	if moved := rank.ChangePercent; moved != nil && *moved != 0 && (*moved > 0) != (result == victory) {
		return true
	}
	opposite, _ := oppositeResult(result)
	return slices.ContainsFunc(rank.Modifiers, func(pill string) bool { return slices.Contains(resultPills[opposite], pill) })
}

// resultReadings is every screenshot's own result reading.
func resultReadings(g Group) []match.FieldReading {
	var out []match.FieldReading
	for _, s := range g.Sources {
		if s.Data.Result != "" {
			out = append(out, ocrReading(s.File, s.Data.Result))
		}
	}
	return out
}
