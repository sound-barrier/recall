package parser_test

import (
	"testing"

	"recall/pkg/parser"
)

// The season-4 placement screen is a rank screen that never says
// "RANK PROGRESS".
//
// During placements Overwatch replaces the settled rank pill with a PREDICTED
// RANK caption and a placement counter, so the detector's single anchor missed
// it, every other probe missed it too, and the file fell through to parseTeams
// — which does not merely decline, it ERRORS ("row OCR: expected 6 stat
// columns, found 0"). That aborts the file, so all nine placement captures in
// the season-4 batch produced no rank row whatsoever; they reached the user
// only as "Failed to read" entries in the Unknown tab, and re-failed on every
// re-parse. This is at the start of a season, when placements are the only
// competitive screens a player has.
//
// The text below is the VERBATIM OCR of the detector band from
// "Overwatch 2 Screenshot 2026.08.16 - 01.18.29.59.png", harvested via
// RECALL_DEBUG_DIR — not an invented sample. Note the tier itself reads
// cleanly, which is why letting the screen through is enough to get an honest
// partial rank row out of it.
const placementBandOCR = `PLATINUM 4

PREDICTED RANK CALCULATED BY WINS AND LOSSES

PLACEMENT PROGRESS: 4/10

Aa i@ua Aa a`

func TestIsRankScreenshot_AcceptsThePlacementScreen(t *testing.T) {
	stubOCR(t, map[string]string{"detect_rank": placementBandOCR})

	ok, err := parser.IsRankScreenshot(tinyImage(), t.TempDir())
	if err != nil {
		t.Fatalf("IsRankScreenshot: %v", err)
	}
	if !ok {
		t.Error("placement screen not detected as a rank screenshot — it falls " +
			"through to parseTeams, which errors, and the capture is never stored at all")
	}
}

// The settled screen must keep working unchanged. Verbatim band OCR from
// "Overwatch 2 Screenshot 2026.08.16 - 03.33.53.60.png".
func TestIsRankScreenshot_StillAcceptsTheSettledScreen(t *testing.T) {
	stubOCR(t, map[string]string{"detect_rank": `a) | \ 2) pe

PLATINUM 2

\y fi} RANK PROGRESS: 67%

HIGHER RANKED THAN 57% ¢`})

	ok, err := parser.IsRankScreenshot(tinyImage(), t.TempDir())
	if err != nil {
		t.Fatalf("IsRankScreenshot: %v", err)
	}
	if !ok {
		t.Error("settled rank screen stopped being detected")
	}
}

// Widening a detector is how a classifier starts eating screens it should
// leave alone, and rank runs FIRST in the probe ladder — anything it claims
// never reaches the summary/personal/teams probes at all. These are the bands
// the other three screens actually present.
func TestIsRankScreenshot_DoesNotClaimOtherScreens(t *testing.T) {
	for name, band := range map[string]string{
		"summary":  "HEROES PLAYED\nTOTAL PERFORMANCE\nPERCENT PLAYED",
		"personal": "WEAPON ACCURACY\nPLAYERS SAVED\nAVG PER 10 MIN: 7.17",
		"teams":    "SYSTEMCTL 20 5 12\nKENNETH117 19 2 7",
		// The word PROGRESS alone must not be enough: an unrelated screen
		// carrying a progress bar is not a rank update.
		"bare progress": "SEASON PROGRESS\n12/30 PROGRESS",
	} {
		t.Run(name, func(t *testing.T) {
			stubOCR(t, map[string]string{"detect_rank": band})
			ok, err := parser.IsRankScreenshot(tinyImage(), t.TempDir())
			if err != nil {
				t.Fatalf("IsRankScreenshot: %v", err)
			}
			if ok {
				t.Errorf("the %s screen was claimed as a rank screenshot; rank probes "+
					"first, so it would never reach its own parser", name)
			}
		})
	}
}
