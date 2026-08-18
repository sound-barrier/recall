package fixtures_test

import (
	"testing"

	"recall/pkg/fixtures"
	"recall/pkg/parser"
)

// A seeded match was never parsed. It was synthesized by THIS build, and
// there is no screenshot behind it to read again.
//
// So every row it writes has to carry the CURRENT parser generation.
// Leaving it zero made the staleness query — which counts anything below the
// current generation — treat the whole sample corpus as the work of an older
// parser: the tour seeded ~1300 matches and then told the user "1339 matches
// were read by an older parser — a re-parse would correct them". False twice
// over. Nothing read them, and Re-parse All cannot improve a row with no
// file, so the count could never drop however many times they tried — the
// same never-reaches-zero trap collectStaleKeys already excludes all_heroes
// rows to avoid.
func TestGenerateMatchFixture_RowsCarryTheCurrentParserGeneration(t *testing.T) {
	fx := fixtures.GenerateMatchFixture(150, 8, "")

	// Every parent table the staleness query reads (staleParseTables), flattened
	// so the assertion is one loop rather than five near-identical ones.
	generations := map[string][]int{}
	for _, r := range fx.Summaries {
		generations["summary"] = append(generations["summary"], r.ParserGeneration)
	}
	for _, r := range fx.Teams {
		generations["teams"] = append(generations["teams"], r.ParserGeneration)
	}
	for _, r := range fx.Personals {
		generations["personal"] = append(generations["personal"], r.ParserGeneration)
	}
	for _, r := range fx.Ranks {
		generations["rank"] = append(generations["rank"], r.ParserGeneration)
	}
	for _, r := range fx.Unknowns {
		generations["unknown"] = append(generations["unknown"], r.ParserGeneration)
	}

	for table, gens := range generations {
		if len(gens) == 0 {
			t.Errorf("%s: fixture emitted no rows — an assertion over them would prove nothing", table)
		}
		for i, g := range gens {
			if g != parser.Generation {
				t.Errorf("%s row %d carries generation %d, want %d — the tour would report it "+
					"as read by an older parser", table, i, g, parser.Generation)
				break
			}
		}
	}
}
