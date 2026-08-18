package parser

import (
	"image"
	"strconv"
)

// The three numeric readings on a rank screen: how far through the tier, how
// far the match moved it, and the banner naming the result.
//
// Every one of these returns a POINTER or an ok-flag rather than a bare int.
// An unread pill is not a zero — a 0% movement claims the match changed
// nothing, which is a different and much more alarming statement than "this
// capture did not show it".

// rankBannerResult reads the top-left banner: "COMPETITIVE VICTORY!" /
// "COMPETITIVE DEFEAT!" / "COMPETITIVE DRAW!". Same prefix-match rule as the
// SUMMARY card (detectResult) so OCR slips like "DEFERT" still classify.
func rankBannerResult(img image.Image, work string) string {
	bounds := img.Bounds()
	W, H := bounds.Dx(), bounds.Dy()
	bannerRect := image.Rect(0, H*7/100, W*45/100, H*22/100)
	bannerText, _ := ocrInverted(img, bannerRect, ocrSpec{workDir: work, name: "rank_banner", psm: "11", whitelist: ""})
	if res := detectResult(bannerText); res != "" {
		return res
	}
	// A hero model rendered behind the banner turns it white-on-bright, which
	// the inverted pass flattens to dark-on-dark ("[EFFAT"). The threshold pass
	// recovers it. This matters more than a missing pill: on a placement screen
	// there are no modifiers, so resultFromModifiers cannot cover for it and the
	// row would carry no result at all.
	occluded, _ := ocrThreshold(img, bannerRect, ocrSpec{workDir: work, name: "rank_banner_occluded", scale: 2, thresh: 180, psm: "11"})
	return detectResult(occluded)
}

// rankProgressPct reads the rank-progress bar's "RANK PROGRESS: 21%" caption
// value. It can be NEGATIVE on a demotion screen ("-19%"); it's thin, colored
// text the inverted pass flattens, so OCR it RAW at 6x over a tight value crop
// just right of the "RANK PROGRESS:" label (whose width is fixed, so the value
// always starts at the same x).
func rankProgressPct(img image.Image, work string) *int {
	bounds := img.Bounds()
	W, H := bounds.Dx(), bounds.Dy()
	progValRect := image.Rect(W*36/100, H*71/100, W*52/100, H*78/100)
	progValText, _ := ocrRaw(img, progValRect, ocrSpec{workDir: work, name: "rank_progress", scale: 6, psm: "7", whitelist: "-0123456789%"})
	if m := rankProgressRe.FindStringSubmatch(progValText); m != nil {
		pct, _ := strconv.Atoi(m[1])
		return &pct
	}
	// nil, not 0: 0% is the BOTTOM of a division, a real place to be. Returning
	// it for "the caption did not read" would put a legitimate-looking value on
	// a screen that never showed one.
	return nil
}

// rankChangePct reads the signed rank-movement pill drawn inside the progress
// bar ("+40%", "-32%"). A defeat's is NEGATIVE — the meter really did move
// backwards — which the old unsigned pattern could not express, so every
// defeat in the corpus stored 0: not "unread", but a confident claim that a
// lost game moved the rank by nothing.
//
// Three passes, none redundant. Each recovers captures the others lose, which
// only re-running the whole corpus makes visible; the crops and preprocessors
// below are measurements, not preferences.
//
// The fourth pass takes `progress` because it reads a band that CONTAINS the
// "RANK PROGRESS: N%" caption, and on a demotion that caption is itself
// negative — so admitting the minus turned it into a false positive that
// copied rank_progress straight into change_percent (a demotion-protection
// capture read -20 for both, from a screen showing no movement pill at all).
// Requiring a sign keeps the other captions out; it cannot keep that one out,
// so the value is rejected when it is exactly the progress this screen already
// reported. That band still earns its place: it is the only one that reads two
// of the corpus's captures.
func rankChangePct(img image.Image, work string, progress *int) *int {
	bounds := img.Bounds()
	W, H := bounds.Dx(), bounds.Dy()

	// (a) INVERTED over the whole bar, below the caption row. The pill is drawn
	// at the edge of the fill, so its x moves with progress: a loss at 67% sits
	// mid-right, a win at 7% near the left. White text on a colored fill
	// inverts to dark-on-light.
	wide := image.Rect(W*24/100, H*760/1000, W*76/100, H*815/1000)
	if pct, ok := signedPct(ocrText(ocrInverted(img, wide, ocrSpec{workDir: work, name: "rank_change_pill", psm: "6", whitelist: signedPctChars}))); ok {
		return &pct
	}
	// (b) THRESHOLDED over the same band. A hard bright-to-black binarization
	// recovers pills the inverted pass flattens — including every 1080p
	// capture, where the thin colored pill is lost by both the inverted and
	// raw passes.
	if pct, ok := signedPct(ocrText(ocrThreshold(img, wide, ocrSpec{workDir: work, name: "rank_change_raw", scale: 6, thresh: 200, psm: "6", whitelist: signedPctChars}))); ok {
		return &pct
	}
	// (c) THRESHOLDED over the historical NARROW window. Tuned before the wide
	// band existed and still the only pass that reads two of the corpus's
	// captures; widening it to match (a) looked tidier and silently zeroed
	// them. A tuned crop is evidence.
	narrow := image.Rect(W*30/100, H*760/1000, W*52/100, H*830/1000)
	if pct, ok := signedPct(ocrText(ocrThreshold(img, narrow, ocrSpec{workDir: work, name: "rank_change_narrow", scale: 6, thresh: 200, psm: "6", whitelist: signedPctChars}))); ok {
		return &pct
	}
	// (d) INVERTED over the tall historical band, which reaches above the bar
	// and so takes in the progress caption. Last, and guarded: a reading equal
	// to the progress already parsed is that caption bleeding through, not a
	// movement. See the note above the signature.
	tall := image.Rect(W*10/100, H*60/100, W*70/100, H*80/100)
	if pct, ok := signedPct(ocrText(ocrInverted(img, tall, ocrSpec{workDir: work, name: "rank_change", psm: "11", whitelist: ""}))); ok && (progress == nil || pct != *progress) {
		return &pct
	}
	// nil, not 0. A 0 here would claim the match moved the rank by exactly
	// nothing — which is what 21 of 44 rank captures used to assert.
	return nil
}

// signedPctChars is the whitelist every movement pass shares: digits, both
// signs, and the percent glyph. No letters, which is half of what keeps the
// surrounding captions from matching.
const signedPctChars = "+-0123456789%"

// ocrText drops the error from an OCR call whose failure is already expressed
// as an empty read — every caller here falls through to the next pass.
func ocrText(s string, _ error) string { return s }

// signedPct reads the rank-movement pill: a REQUIRED sign, then the magnitude.
// A loss reads negative — the meter really did move backwards — which the
// old unsigned form could not express, so every defeat in the corpus stored 0.
func signedPct(text string) (int, bool) {
	m := rankChangeRe.FindStringSubmatch(text)
	if m == nil {
		return 0, false
	}
	pct, err := strconv.Atoi(m[2])
	if err != nil {
		return 0, false
	}
	if m[1] == "-" {
		pct = -pct
	}
	return pct, true
}
