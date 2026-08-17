package parser_test

import (
	"reflect"
	"strconv"
	"strings"
	"testing"

	"recall/pkg/parser"
)

// extractSR locates each hero card by searching a lowercased COPY of the OCR
// text, then slices the ORIGINAL text with the offsets it found. Unicode case
// mapping is not length-preserving — U+0130 (İ) lowercases to a 1-byte "i",
// U+023A (Ⱥ) to a 3-byte "ⱥ" — so a single cased multi-byte rune anywhere
// ahead of the cards desynchronizes every later offset. A shrinking rune
// silently slid each card's window and mis-read its change; a growing one ran
// the window past the end of the string and PANICKED the parse
// ("slice bounds out of range"), taking the whole parse worker with it.
func TestExtractSR_MultibyteNoiseDoesNotDesyncTheCardWindows(t *testing.T) {
	const cards = " LUCIO SR 2754 +30 ANA SR 1896 +8"
	want := []parser.HeroSR{
		{Hero: "lucio", SR: 2754, Change: 30},
		{Hero: "ana", SR: 1896, Change: 8},
	}
	cases := []struct {
		name, noise string
	}{
		{"no noise", ""},
		{"rune that shrinks when lowercased", "İ"},
		{"rune that grows when lowercased", "Ⱥ"},
		{"a run of growing runes", strings.Repeat("Ⱥ", 20)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := parser.ExtractSR(c.noise + cards); !reflect.DeepEqual(got, want) {
				t.Errorf("ExtractSR(%q) = %+v, want %+v", c.noise+cards, got, want)
			}
		})
	}
}

// srFromRun's 5-digit recovery drops whichever edge digit leaves a plausible
// SR. The leading-stray case (the change arrow read as a digit) was pinned;
// the TRAILING one — the SR icon glyph landing after the value — reaches the
// other branch, and nothing covered it.
func TestSRFromRun_TrailingStrayDigitDropped(t *testing.T) {
	if got := parser.SRFromRun("17779"); got != 1777 {
		t.Errorf("SRFromRun(%q) = %d, want 1777", "17779", got)
	}
}

// ─────────────────────────────────────────────────────────────────────────
// The SR-panel backfill: cards whose 4-digit value the sparse pass missed
// get a digit-forced re-OCR of the same region under two page-segmentation
// modes. Region names below are the parse pipeline's dispatch vocabulary.

// rankSR runs parseRank against a canned OCR table on a stub image, so each
// test only has to name the regions it cares about.
func rankSR(t *testing.T, table map[string]string) *parser.MatchResult {
	t.Helper()
	stubOCR(t, table)
	res, err := parser.ParseRank(tinyImage(), t.TempDir())
	if err != nil {
		t.Fatalf("ParseRank: %v", err)
	}
	return res
}

func assertSRValues(t *testing.T, got []parser.HeroSR, want []parser.HeroSR) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("SR cards = %+v, want %+v", got, want)
	}
}

// Both cards read a hero but no 4-digit value (the stylized SR glyphs defeat
// the sparse pass). The digit-forced re-read supplies them in reading order.
func TestParseRank_BackfillsZeroSRCardsFromTheDigitForcedReread(t *testing.T) {
	res := rankSR(t, map[string]string{
		"rank_sr":          "LUCIO SR ---- ^30\nANA SR ---- ^8",
		"rank_sr_digits_6": "2754\n1896",
		"rank_modifiers":   "VICTORY",
	})
	assertSRValues(t, res.SR, []parser.HeroSR{
		{Hero: "lucio", SR: 2754},
		{Hero: "ana", SR: 1896},
	})
}

// A value the card text already yielded is kept AND withheld from the
// candidate pool, so the zero card can't be handed a duplicate of it.
func TestParseRank_BackfillNeverReassignsAnAlreadyReadSR(t *testing.T) {
	res := rankSR(t, map[string]string{
		"rank_sr":          "LUCIO SR 2754 ^30\nANA SR ---- ^8",
		"rank_sr_digits_6": "2754\n1896",
		"rank_modifiers":   "VICTORY",
	})
	assertSRValues(t, res.SR, []parser.HeroSR{
		{Hero: "lucio", SR: 2754, Change: 30},
		{Hero: "ana", SR: 1896},
	})
}

// Stacked cards surface differently under PSM 6 and PSM 3, so the candidate
// pool is the UNION of both passes — deduplicated, in reading order. Pinning
// this stops a "one pass is enough" simplification from silently dropping the
// third card.
func TestParseRank_BackfillUnionsBothSegmentationModes(t *testing.T) {
	res := rankSR(t, map[string]string{
		"rank_sr":          "LUCIO SR ---- \nANA SR ---- \nKIRIKO SR ---- ",
		"rank_sr_digits_6": "2754",
		"rank_sr_digits_3": "2754\n1896\n3120",
		"rank_modifiers":   "VICTORY",
	})
	assertSRValues(t, res.SR, []parser.HeroSR{
		{Hero: "lucio", SR: 2754},
		{Hero: "ana", SR: 1896},
		{Hero: "kiriko", SR: 3120},
	})
}

// The backfill is an expensive two-pass re-OCR; a clean sparse read must not
// pay for it.
func TestParseRank_DigitForcedRereadSkippedWhenEveryCardRead(t *testing.T) {
	regions := recordingStubOCR(t, map[string]string{
		"rank_sr":        "LUCIO SR 2754 ^30",
		"rank_modifiers": "VICTORY",
	})
	res, err := parser.ParseRank(tinyImage(), t.TempDir())
	if err != nil {
		t.Fatalf("ParseRank: %v", err)
	}
	assertSRValues(t, res.SR, []parser.HeroSR{{Hero: "lucio", SR: 2754, Change: 30}})
	for _, r := range *regions {
		if strings.HasPrefix(r, "rank_sr_digits") {
			t.Errorf("digit-forced re-read %q must not fire when every card already has an SR", r)
		}
	}
}

// The card shows direction as a colored arrow, not a sign, so extractSR
// returns a magnitude and parseRank applies the sign AFTER the result is
// finalized — including when the result came from the modifier pill rather
// than the (unreliable) banner. A defeat whose SR losses were stored positive
// would read as a gain everywhere downstream.
func TestParseRank_SRChangeSignFollowsTheFinalizedResult(t *testing.T) {
	cases := []struct {
		name, pill string
		wantResult string
		wantChange int
	}{
		{"defeat via the modifier pill", "x DEFEAT || CONSOLATION", "defeat", -30},
		{"victory via the modifier pill", "* VICTORY || EXPECTED", "victory", 30},
		{"draw leaves the magnitude alone", "DRAW", "draw", 30},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := rankSR(t, map[string]string{
				"rank_banner":    "",
				"rank_modifiers": c.pill,
				"rank_sr":        "LUCIO SR 2754 ^30",
			})
			if res.Result != c.wantResult {
				t.Fatalf("Result = %q, want %q", res.Result, c.wantResult)
			}
			assertSRValues(t, res.SR, []parser.HeroSR{{Hero: "lucio", SR: 2754, Change: c.wantChange}})
		})
	}
}

// The match's primary hero and role come from the TOP card, not the last one
// read — the panel stacks the most-played hero first and the dossier keys
// role filters off it.
func TestParseRank_PrimaryHeroAndRoleComeFromTheTopSRCard(t *testing.T) {
	res := rankSR(t, map[string]string{
		"rank_sr":        "REINHARDT SR 2500 ^20\nANA SR 1896 ^8",
		"rank_modifiers": "VICTORY",
	})
	if res.Hero != "reinhardt" || res.Role != "tank" {
		t.Errorf("hero/role = %q/%q, want reinhardt/tank", res.Hero, res.Role)
	}
}

// showPct renders a nullable rank reading for a failure message. %v on a *int
// prints an address, which tells the reader nothing about what went wrong.
func showPct(p *int) string {
	if p == nil {
		return "nil (unread)"
	}
	return strconv.Itoa(*p)
}

// A demotion screen's progress bar reads NEGATIVE. An unsigned capture would
// store -19% as +19% and draw the climb chart moving the wrong way.
func TestParseRank_RankProgressKeepsTheDemotionSign(t *testing.T) {
	cases := []struct {
		name, ocr string
		want      *int
	}{
		{"demotion", "-19%", new(-19)},
		{"ordinary progress", "21%", new(21)},
		// nil, NOT 0. 0% is the bottom of a division — a real place to be — so
		// returning it for a caption that did not read would put a legitimate
		// value on a screen that never showed one.
		{"unreadable", "|||", nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := rankSR(t, map[string]string{"rank_progress": c.ocr})
			if !reflect.DeepEqual(res.RankProgress, c.want) {
				t.Errorf("RankProgress = %s, want %s", showPct(res.RankProgress), showPct(c.want))
			}
		})
	}
}

// The "+N%" gain pill is thin colored text: the inverted pass reads it at
// 1440p but flattens it at 1080p, where only the thresholded 6x re-read of
// the isolated pill band recovers it. Losing that fallback silently zeroes
// every 1080p capture's rank change.
func TestParseRank_ChangePercentFallsBackToTheThresholdedPill(t *testing.T) {
	cases := []struct {
		name, wide, pill string
		want             *int
	}{
		{"wide inverted pass reads the pill", "RANK PROGRESS: 52% +21%", "", new(21)},
		{"1080p: only the thresholded pill band reads", "RANK PROGRESS: 52%", "+7%", new(7)},
		// nil, not 0 — this is the case the old int could not express, and the
		// reason 21 of 44 corpus captures claimed a match moved the rank by
		// nothing when the pill had simply never been read.
		{"neither reads", "RANK PROGRESS: 52%", "", nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := rankSR(t, map[string]string{
				"rank_change":     c.wide,
				"rank_change_raw": c.pill,
			})
			if !reflect.DeepEqual(res.ChangePercent, c.want) {
				t.Errorf("ChangePercent = %s, want %s", showPct(res.ChangePercent), showPct(c.want))
			}
		})
	}
}

// The fuzzy pass recovers a mangled hero name ("JUMKRAT" → junkrat), but the
// recovered name has no literal occurrence in the card text — so that card's
// own text window can't be located and its SR reads 0. The digit-forced
// backfill is what rescues the value. The two halves of that contract have to
// stay in step: drop the backfill and a single-letter OCR slip silently zeroes
// the hero's SR instead of merely garbling the name.
func TestParseRank_FuzzyMatchedHeroStillGetsItsSRFromTheBackfill(t *testing.T) {
	res := rankSR(t, map[string]string{
		"rank_sr":          "JUMKRAT SR 2754 ^30",
		"rank_sr_digits_6": "2754",
		"rank_modifiers":   "VICTORY",
	})
	assertSRValues(t, res.SR, []parser.HeroSR{{Hero: "junkrat", SR: 2754}})
}
