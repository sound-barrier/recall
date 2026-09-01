package db_test

import (
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"

	"recall/pkg/db"
	"recall/pkg/parser"
)

// The rank_modifiers CHECK is a hand-maintained copy of the parser's
// vocabulary, and the comment above it says so: "Keep in sync: a new modifier
// in pkg/parser must be added here too, or its insert fails."
//
// It drifted anyway. "winning trend" and "losing trend" were added to the
// parser for the 2026-07 UI and never reached either CHECK list, and the
// failure mode is worse than a dropped pill: UpsertRank writes the parent, the
// modifiers, and the SR lines in ONE transaction and returns the child's
// error, so a screenshot carrying either chip discards the WHOLE rank row —
// tier, level, progress, SR, all of it. The user sees a rank screenshot that
// parsed fine and simply has no rank.
//
// The golden corpus cannot catch this. Goldens pin parser output and never
// touch a database, and three committed goldens carry these exact values.
// This is the test that closes that gap.
func TestUpsertRank_TrendModifiersSurviveTheRoundTrip(t *testing.T) {
	for _, mod := range []string{"winning trend", "losing trend"} {
		t.Run(mod, func(t *testing.T) {
			s := openMemory(t)
			row := db.RankRow{
				Filename: "r.png", MatchKey: "k1", Rank: "platinum", Level: 2,
				RankProgress: new(67), Result: "victory",
				Modifiers: []string{mod},
				SR:        []db.HeroSR{{Hero: "juno", SR: 2065, Change: new(115)}},
			}
			if err := s.UpsertRank(row); err != nil {
				t.Fatalf("UpsertRank(%q) = %v — the parser emits this value, so the "+
					"schema must accept it; the whole rank row is lost otherwise", mod, err)
			}

			got := loadOneRank(t, s)
			if got.Rank != "platinum" || got.Level != 2 {
				t.Errorf("rank = %q %d, want platinum 2 — the row survived but lost its tier",
					got.Rank, got.Level)
			}
			if len(got.Modifiers) != 1 || got.Modifiers[0] != mod {
				t.Errorf("modifiers = %v, want [%s]", got.Modifiers, mod)
			}
			if len(got.SR) != 1 || got.SR[0].SR != 2065 {
				t.Errorf("sr = %+v, want juno at 2065 — the SR line went with the row", got.SR)
			}
		})
	}
}

// checkListRe pulls the quoted vocabulary out of each
// `CHECK (modifier IN ( ... ))` block in schema.sql. There are two — the OCR
// table and its user-override twin — and both must carry the same list.
var (
	checkListRe = regexp.MustCompile(`(?s)modifier TEXT NOT NULL CHECK \(modifier IN \((.*?)\)\)`)
	quotedRe    = regexp.MustCompile(`'([^']*)'`)
)

// The structural fix for the drift above: assert the schema's vocabulary IS
// the parser's, rather than trusting a comment to keep two hand-written lists
// aligned.
//
// StorableModifiers() is the right side of the comparison because it is
// exactly "every value the parser can put on a MatchResult" — the
// substring-matched vocabulary plus "demotion protection", which parseRank
// appends out-of-band when it sees a bare "DEMOTION" stem.
func TestSchemaModifierCheck_MatchesTheParserVocabulary(t *testing.T) {
	raw, err := os.ReadFile("schema.sql")
	if err != nil {
		t.Fatalf("read schema.sql: %v", err)
	}

	blocks := checkListRe.FindAllStringSubmatch(string(raw), -1)
	if len(blocks) != 2 {
		t.Fatalf("found %d modifier CHECK blocks in schema.sql, want 2 "+
			"(rank_modifiers and user_match_rank_modifiers) — if a table was added or "+
			"renamed, this test must learn about it rather than silently cover less",
			len(blocks))
	}

	want := parser.StorableModifiers()
	slices.Sort(want)

	for i, b := range blocks {
		var got []string
		for _, m := range quotedRe.FindAllStringSubmatch(b[1], -1) {
			got = append(got, m[1])
		}
		slices.Sort(got)
		if !slices.Equal(got, want) {
			t.Errorf("CHECK block %d vocabulary is out of sync with the parser.\n"+
				"  schema.sql: %s\n"+
				"  parser:     %s\n"+
				"missing from schema: %v\n"+
				"A value the parser emits but the schema rejects does not drop the pill — "+
				"UpsertRank runs one transaction, so it discards the entire rank row.",
				i+1, strings.Join(got, ", "), strings.Join(want, ", "), missing(want, got))
		}
	}
}

// missing returns the values in want that got does not carry.
func missing(want, got []string) []string {
	var out []string
	for _, w := range want {
		if !slices.Contains(got, w) {
			out = append(out, w)
		}
	}
	return out
}
