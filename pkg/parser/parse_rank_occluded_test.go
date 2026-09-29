package parser_test

import (
	"maps"
	"testing"

	"recall/pkg/parser"
)

// A bright hero model behind a SETTLED rank card turns every white caption
// white-on-bright; the inverted passes flatten it to noise and the screen
// used to store nothing but its change pill. Every OCR string below is
// verbatim output harvested from the crops of
// "Overwatch 2 Screenshot 2026.09.24 - 21.14.15.53.png" (diagnostic bundle
// 2026-09-25), whose pixels read DEFEAT, PLATINUM 3, RANK PROGRESS 8%,
// HIGHER RANKED THAN 49%, and JUNO 2253 / WUYANG 2210 / MIZUKI 2086.
var occludedSettledOCR = map[string]string{
	"rank_banner":              "",
	"rank_banner_occluded":     "iM  NMDETITINIC",
	"rank_banner_occluded_200": "PNAANCTITV DEFERT",
	"rank_tier":                "» \\\n\na \\ \\ :\n\nDe\n\n~\n\nIN\n\n¢\n\nyw @\n\nKED THAN 495\n\na",
	"rank_tier_v2":             "W PH THAN 34",
	"rank_tier_occluded":       "RE PLATING 34 VX CJ RANK PROGRESS: HIGHER RANKED THAN",
	"rank_percentile_occluded": "WW ry 7 t © PAIN J ny 2a a oN \\vf Ci} RANK PROGRESS: IGHER RANKED THAN 49% €",
	"rank_badge":               "3",
	"rank_progress":            "",
	"rank_progress_occluded":   "8%",
	"rank_sr":                  "hs  t.  XN  a Ge  Ns  ~ -5  La  ye  Fi  ¥  0  l,  - 4",
	"rank_sr_occluded":         "100 7RESS Wins Chaat 3 praqgress, .assas craat | a \\ JUNO SR if 2253 WUYANG 5R 2210 MIZUKI SR 2086",
}

func TestParseRank_OccludedSettledScreenRecoversEveryReading(t *testing.T) {
	stubOCR(t, occludedSettledOCR)
	res, err := parser.ParseRank(tinyImage(), t.TempDir())
	if err != nil {
		t.Fatalf("ParseRank: %v", err)
	}
	assertOccludedCardReadings(t, res)
	assertOccludedSRCards(t, res.SR)
}

func assertOccludedCardReadings(t *testing.T, res *parser.MatchResult) {
	t.Helper()
	if res.Result != "defeat" {
		t.Errorf("result = %q, want defeat", res.Result)
	}
	if res.Rank != "platinum" || res.Level != 3 {
		t.Errorf("rank/level = %q/%d, want platinum/3 (the caption's trailing 4 is noise; the badge says 3)", res.Rank, res.Level)
	}
	if res.RankProgress == nil || *res.RankProgress != 8 {
		t.Errorf("rank_progress = %v, want 8", res.RankProgress)
	}
	if res.RankPercentile == nil || *res.RankPercentile != 49 {
		t.Errorf("rank_percentile = %v, want 49", res.RankPercentile)
	}
}

func assertOccludedSRCards(t *testing.T, cards []parser.HeroSR) {
	t.Helper()
	wantSR := map[string]int{"juno": 2253, "wuyang": 2210, "mizuki": 2086}
	if len(cards) != len(wantSR) {
		t.Fatalf("SR cards = %+v, want %d", cards, len(wantSR))
	}
	for _, card := range cards {
		if card.SR != wantSR[card.Hero] {
			t.Errorf("%s SR = %d, want %d", card.Hero, card.SR, wantSR[card.Hero])
		}
		// The red change digits do not survive a threshold; an unread change
		// must stay nil rather than borrow a neighbor's digit.
		if card.Change != nil {
			t.Errorf("%s change = %d, want nil (unread)", card.Hero, *card.Change)
		}
	}
}

// The badge numeral is the level's only trusted source on an occluded card.
// Without it the tier stays empty — a wrong division is worse than none.
func TestParseRank_OccludedTierStaysEmptyWithoutABadgeNumeral(t *testing.T) {
	ocr := maps.Clone(occludedSettledOCR)
	ocr["rank_badge"] = ""
	stubOCR(t, ocr)
	res, err := parser.ParseRank(tinyImage(), t.TempDir())
	if err != nil {
		t.Fatalf("ParseRank: %v", err)
	}
	if res.Rank != "" || res.Level != 0 {
		t.Errorf("rank/level = %q/%d, want empty when the badge did not read", res.Rank, res.Level)
	}
}

// The badge sits elsewhere on the PLACEMENT layout, so the occluded tier
// read is gated on a settled-screen caption. A placement band must not reach
// the settled badge rect and mint a division from whatever is there.
func TestParseRank_OccludedTierFallbackIgnoresThePlacementScreen(t *testing.T) {
	ocr := maps.Clone(occludedSettledOCR)
	ocr["rank_tier_occluded"] = "PREDICTED RANK PLATINUM 5 PREDICTED RANK CALCULATED BY WINS AND LOSSES PLACEMENT PROGRESS: 3/10"
	stubOCR(t, ocr)
	res, err := parser.ParseRank(tinyImage(), t.TempDir())
	if err != nil {
		t.Fatalf("ParseRank: %v", err)
	}
	if res.Rank != "" || res.Level != 0 {
		t.Errorf("rank/level = %q/%d, want empty on a placement screen", res.Rank, res.Level)
	}
}

// A normally-lit screen keeps its one-pass reads: no fallback region may be
// OCR'd when the first pass of every reader succeeded.
func TestParseRank_LitScreenNeverRunsTheOccludedFallbacks(t *testing.T) {
	regions := recordingStubOCR(t, map[string]string{
		"rank_banner":   "COMPETITIVE DEFEAT",
		"rank_tier":     "PLATINUM 2\nRANK PROGRESS: 67%\nHIGHER RANKED THAN 57%",
		"rank_progress": "67%",
		"rank_sr":       "JUNO SR 2253 8",
	})
	if _, err := parser.ParseRank(tinyImage(), t.TempDir()); err != nil {
		t.Fatalf("ParseRank: %v", err)
	}
	for _, r := range *regions {
		switch r {
		case "rank_banner_occluded", "rank_banner_occluded_200", "rank_tier_occluded",
			"rank_percentile_occluded", "rank_badge", "rank_progress_occluded", "rank_sr_occluded":
			t.Errorf("fallback region %q OCR'd on a lit screen", r)
		}
	}
}
