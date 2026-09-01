package parser

import (
	"image"
	"strings"
)

// Rank-screen parsing: detecting the screen and orchestrating the readings.
//
// The extraction itself is split by WHAT IT READS, because those parts fail
// independently and get fixed independently — a season that restyles the
// modifier pills does not touch the SR panel, and a tier rename does not touch
// the movement pill. The sibling files are parse_rank_tier.go (the pill and its
// percentile caption), parse_rank_readings.go (progress, movement, the result
// banner), parse_rank_modifiers.go (the chip row) and parse_rank_sr.go (the
// per-hero SR panel).

// rankScreenAnchors are the captions unique to a competitive rank-update
// screen. SUMMARY / TEAMS / PERSONAL never show any of them.
//
// "RANK PROGRESS" is the settled screen. The other two are the PLACEMENT
// screen, which shows a PREDICTED RANK caption and a placement counter instead
// of a settled pill, and so carries neither of those words — it went undetected
// for the whole of season 4's placement period. That is not a soft miss: rank
// probes first, every other probe also declines, and the file falls through to
// parseTeams, whose row OCR ERRORS on a non-scoreboard ("expected 6 stat
// columns, found 0") rather than declining. That aborts the file, so the
// capture yields no rank row at all and lands in the failed-files ledger —
// visible to the user only as a "Failed to read" row in the Unknown tab, and
// re-failing on every re-parse. A placement run is when a player has nothing
// BUT placement screens.
//
// Both placement anchors are matched because they are independent OCR risks on
// the same screen: one is a long sentence that can garble mid-word, the other a
// short label beside a digit pair.
var rankScreenAnchors = []string{
	"RANK PROGRESS",
	"PLACEMENT PROGRESS",
	"PREDICTED RANK",
}

// isRankScreenshot detects the post-match competitive rank screen, settled or
// mid-placement, by the captions in its middle band.
func isRankScreenshot(img image.Image, work string) (bool, error) {
	bounds := img.Bounds()
	W, H := bounds.Dx(), bounds.Dy()
	rect := image.Rect(W*10/100, H*55/100, W*70/100, H*78/100)
	text, err := ocrInverted(img, rect, ocrSpec{workDir: work, name: "detect_rank", psm: "11", whitelist: ""})
	if err != nil {
		return false, err
	}
	if hasRankAnchor(text) {
		return true, nil
	}
	// The inverted pass assumes white-on-dark, which the rank screen normally
	// is. It is not when the competitive menu renders a HERO MODEL behind the
	// card: the captions become white-on-bright, invert to dark-on-dark, and
	// the band OCRs to fragments ("SS: 3/" was the only survivor on one
	// capture). Every probe then declines and the file falls through to
	// parseTeams, which errors rather than declining — so an occluded capture
	// produced no row at all and reached the user only as "Failed to read".
	//
	// A hard bright-to-black threshold isolates exactly the text the inverted
	// pass loses. It runs only when the first pass found nothing, so a
	// normally-lit rank screen still costs one OCR; the price is one extra
	// pass on screenshots that are not rank screens at all.
	occluded, err := ocrThreshold(img, rect, ocrSpec{workDir: work, name: "detect_rank_occluded", scale: 3, thresh: 200, psm: "6"})
	if err != nil {
		return false, err
	}
	return hasRankAnchor(occluded), nil
}

// hasRankAnchor reports whether an OCR'd band carries any caption unique to the
// competitive rank screen.
func hasRankAnchor(text string) bool {
	upper := strings.ToUpper(text)
	for _, anchor := range rankScreenAnchors {
		if strings.Contains(upper, anchor) {
			return true
		}
	}
	return false
}

// parseRank handles the post-match competitive rank screen: the tier badge
// (PLATINUM 5), the rank-progress bar with its change percentage, the match
// modifier pills (EXPECTED / VICTORY / etc.), and the per-hero SR + delta
// panel on the right. mode is forced to "competitive" because this screen
// only shows up for ranked play. Each OCR stage lives in its own rank*
// helper; parseRank keeps the cross-stage glue (result fallback, SR sign).
func parseRank(img image.Image, work string) (*MatchResult, error) {
	res := &MatchResult{Playlist: "competitive", RankScreen: true}
	res.Result = rankBannerResult(img, work)
	rank, level, tierBand := rankTierLevel(img, work)
	res.Rank, res.Level = rank, level
	res.RankPercentile = extractRankPercentile(tierBand)
	res.RankProgress = rankProgressPct(img, work)
	res.ChangePercent = rankChangePct(img, work, res.RankProgress)
	mods, modifierBand := rankModifierPills(img, work)
	res.Modifiers = mods
	// A chip the closed vocabulary does not carry used to be logged and then
	// DROPPED, which is how "variance" rode every post-placement screen of a
	// whole season unnoticed. Keep the text on the result so it reaches the row.
	//
	// It is preserved as raw text and never as a modifier. The distinction is
	// measured, not stylistic: across the 37 rank captures in the corpus this
	// detection fires on 3 that have no new chip at all — an ENDORSEMENT
	// RECEIVED toast overlapping the band, and two OCR garbles. At an 8% false
	// -positive rate, asserting these ARE modifiers would corrupt the vocabulary
	// the filters and the dossier count against; reporting them as text the
	// parser could not account for is exactly as strong a claim as the evidence.
	//
	// Still NOT a parse warning, for the same reason: a warning routes to the
	// failed-files ledger and would put a "Failed to read" row on captures with
	// nothing wrong with them. The log stays too — it is the greppable trail for
	// whoever investigates a season change, and it costs the user nothing.
	recordUnknownChips(res, modifierBand)
	rankSRPanel(img, work, res)

	// The top-left banner OCR is unreliable (italic ALL-CAPS over a busy
	// gradient — "COMPETITIVE DEFEAT" reads as "CAMDETITIVE [FFFAT"); fall back
	// to the win/loss/draw modifier pill when the banner didn't classify.
	if res.Result == "" {
		res.Result = resultFromModifiers(res.Modifiers)
	}

	// Per-hero SR change: extractSR captured the magnitude; the card's arrow
	// (green up = gain, red down = loss) tracks the match result, which isn't in
	// the OCR text. Apply the sign once res.Result is finalized so a defeat's
	// losses read negative.
	if res.Result == "defeat" {
		for i := range res.SR {
			if res.SR[i].Change == nil {
				continue
			}
			negated := -*res.SR[i].Change
			res.SR[i].Change = &negated
		}
	}

	return res, nil
}
