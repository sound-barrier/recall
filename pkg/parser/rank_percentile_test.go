package parser_test

import (
	"testing"

	"recall/pkg/parser"
)

// The percentile caption shares its band — and its ROW — with
// "RANK PROGRESS: 67%". A bare "first percentage in this crop" scan reads the
// wrong number, and reads it plausibly: both are 0-100, so the mistake would
// surface as a believable-but-false statistic rather than as an obvious break.
// That is the whole reason the regex is anchored on the words.
//
// Every band string below is VERBATIM OCR harvested via RECALL_DEBUG_DIR from
// the season-4 captures, garble included, not an idealized sample.
type percentileCase struct {
	name string
	band string
	want int // -1 means "expect nil"
}

// Every band is VERBATIM OCR from a real capture, garble included.
func percentileCases() []percentileCase {
	return []percentileCase{
		{
			name: "reads the caption, not the progress percentage on the same row",
			band: "a) | \\ 2) pe\n\nPLATINUM 2\n\n\\y fi} RANK PROGRESS: 67%\n\nHIGHER RANKED THAN 57% ¢",
			want: 57,
		},
		{
			// Here the progress value (7) is a PREFIX of the percentile (59) in
			// digit terms and much smaller — a positional heuristic would have
			// no way to tell them apart.
			name: "single-digit progress beside a two-digit percentile",
			band: "PLATINUM 1\n\n\\y GG] Rank PROGRESS: 7%\n\nHIGHER RANKED THAN 59% ¢",
			want: 59,
		},
		{
			name: "third real capture",
			band: "ae\n\nPLATINUM 1\n\n\\Y (i) RANK PROGRESS: 44%\n\nHIGHER RANKED THAN 61% ¢",
			want: 61,
		},
		{
			// The placement band. No caption exists during placements because
			// there is no settled rank to be a percentile of, so nil is the
			// honest answer — NOT 4, the placement counter's numerator.
			name: "placement screen has no percentile",
			band: placementBandOCR,
			want: -1,
		},
		{
			name: "pre-season-4 band with only a progress caption",
			band: "GOLD 3\n\nRANK PROGRESS: 21%",
			want: -1,
		},
		{
			name: "empty band",
			band: "",
			want: -1,
		},
		{
			// The band is multi-line and "RANK PROGRESS: 67%" is the line
			// ABOVE the caption. If the caption's own number is ever clipped
			// away, the match must not walk to the next line and store the
			// progress value as the percentile.
			name: "does not jump to the next OCR line for its number",
			band: "PLATINUM 2\n\nHIGHER RANKED THAN\n67%\nOF PLAYERS",
			want: -1,
		},
		{
			// Guard the sanity bound: a garbled read must not store a number
			// that cannot be a percentage.
			name: "out-of-range value is rejected rather than stored",
			band: "HIGHER RANKED THAN 570% OF PLAYERS",
			want: -1,
		},
	}
}

func TestExtractRankPercentile(t *testing.T) {
	for _, tc := range percentileCases() {
		t.Run(tc.name, func(t *testing.T) {
			got := parser.ExtractRankPercentile(tc.band)
			if tc.want < 0 {
				if got != nil {
					t.Errorf("percentile = %d, want nil", *got)
				}
				return
			}
			if got == nil {
				t.Fatalf("percentile = nil, want %d", tc.want)
			}
			if *got != tc.want {
				t.Errorf("percentile = %d, want %d", *got, tc.want)
			}
		})
	}
}
