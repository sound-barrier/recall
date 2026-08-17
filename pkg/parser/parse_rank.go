package parser

import (
	"image"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"recall/pkg/applog"
)

// knownModifiers is the substring-matched rank-update vocabulary, derived from
// modifiers.yaml. It used to be a literal slice here, restated by hand in two
// SQL CHECK lists and a frontend constant; all three drifted. See
// modifiers.go / modifiers.yaml — adding a modifier is a YAML edit.
//
// "demotion protection" is deliberately NOT in this list: its chip OCRs as a
// bare stem, so parseRank appends it out-of-band below. It IS in
// StorableModifiers(), which is what the schema must accept.
func knownModifiers() []string { return Modifiers() }

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
			res.SR[i].Change = -res.SR[i].Change
		}
	}

	return res, nil
}

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

// rankTierLevel reads the tier label ("PLATINUM 5") that sits just below the
// badge, from the same wide band the detector probes (10-70% W, down to 78% H,
// which also holds the "RANK PROGRESS" caption extractRank ignores): a tighter
// center crop garbles the tier on some captures ("GOLD" → "GOD" / "6010" /
// "solo"), so extractRank returns no rank and the whole screen is
// misclassified as summary/unknown.
// The returned bandText is the PRIMARY (PSM 11) pass over this band. It is
// handed back rather than discarded because the season-4 percentile caption
// ("HIGHER RANKED THAN 57% OF PLAYERS") renders inside this same crop and is
// legible in it on every capture in the corpus — so reading the percentile
// costs no additional Tesseract invocation, which at ~8 OCR passes per rank
// screen is worth more than a tidier signature.
func rankTierLevel(img image.Image, work string) (rank string, level int, bandText string) {
	bounds := img.Bounds()
	W, H := bounds.Dx(), bounds.Dy()
	tierRect := image.Rect(W*10/100, H*55/100, W*70/100, H*78/100)
	tierText, _ := ocrInverted(img, tierRect, ocrSpec{workDir: work, name: "rank_tier", psm: "11", whitelist: ""})
	rank, level = extractRank(tierText)
	// The 2026-07 UI renders the division caption in a stylized face whose
	// numerals the sparse pass misreads as letters ("GOLD 3" → "GOLD J",
	// "PLATINUM 5" → "PI ATINUM J" — and J is ambiguous between 3 and 5, so
	// no digitize mapping can recover it) or that corrupt the tier word
	// itself ("FOLD?"). A PSM-6 re-read of the SAME band resolves the
	// caption line cleanly; the whitelist pins the alphabet to tier words +
	// levels 1-5 so the numeral cannot resolve to a letter. Fires only when
	// the sparse pass came back incomplete — no committed old-UI golden has
	// level 0, so the existing corpus never re-reads.
	if rank == "" || level == 0 {
		v2Text, _ := ocrInverted(img, tierRect, ocrSpec{workDir: work, name: "rank_tier_v2", psm: "6", whitelist: rankTierWhitelist})
		if r2, l2 := extractRank(v2Text); r2 != "" && (rank == "" || l2 != 0) {
			rank, level = r2, l2
		}
	}
	return rank, level, tierText
}

var (
	rankProgressRe = regexp.MustCompile(`(-?\d{1,3})\s*%`)
	// The sign is REQUIRED, not optional, and that is load-bearing. The bands
	// this runs over also carry "RANK PROGRESS: 67%" and "HIGHER RANKED THAN
	// 57% OF PLAYERS"; an optional sign would match those and store a progress
	// or population figure as the match's rank movement. The pill always
	// renders its sign ("+40%", "-32%"), so requiring one costs nothing.
	rankChangeRe = regexp.MustCompile(`([+-])\s*(\d{1,3})\s*%`)
	// Anchored on the WORDS, not on "some percentage in this band". The band
	// also holds "RANK PROGRESS: 67%", which sits on the same row and would win
	// a bare `(\d+)%` scan. RANKED is spelled loosely because the caption's tail
	// clips at the crop's right edge ("HIGHER RANKED THAN 57% ¢") and OCR
	// wobbles on the surrounding glyphs, but the two words either side of the
	// number are what make the match unambiguous.
	//
	// [ \t] rather than \s, deliberately: \s matches a newline, so if the
	// caption's own number were ever clipped away the match would jump to the
	// NEXT OCR line and store whatever percentage began it — and the line
	// above this one in the band is "RANK PROGRESS: 67%".
	rankPercentileRe = regexp.MustCompile(`(?i)HIGHER[ \t]+RANKED[ \t]+THAN[ \t]+(\d{1,3})[ \t]*%`)
)

// extractRankPercentile reads the season-4 "HIGHER RANKED THAN 57% OF PLAYERS"
// caption — the share of the population the player is above.
//
// nil means the screen did not show one, which is a real state rather than a
// failure: the caption is absent for the whole of placements, where there is no
// settled rank to be a percentile of. That is why the field is a pointer all
// the way to the database — a 0 here would claim the player is above nobody.
func extractRankPercentile(bandText string) *int {
	m := rankPercentileRe.FindStringSubmatch(bandText)
	if m == nil {
		return nil
	}
	pct, err := strconv.Atoi(m[1])
	if err != nil || pct < 0 || pct > 100 {
		return nil
	}
	return &pct
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

// rankModifierPills reads the modifier pills below the progress bar. The right
// edge reaches 76% (was 55%, then 72%): the pills are centered under the bar
// and drift right-of-center as rank progress climbs — on the 2026-07 UI a lone
// "VICTORY" chip at 100% progress sits at ~68-73% W and clipped to
// "VICTC" at the 72% cut, losing the modifier AND the result fallback.
// 76% still stops short of the right-hand rank-tier badge (~78%+), so no
// icon noise bleeds in; the old-UI corpus goldens pin that.
func rankModifierPills(img image.Image, work string) (mods []string, bandText string) {
	bounds := img.Bounds()
	W, H := bounds.Dx(), bounds.Dy()
	modifierRect := image.Rect(W*10/100, H*78/100, W*76/100, H*90/100)
	modifierText, _ := ocrInverted(img, modifierRect, ocrSpec{workDir: work, name: "rank_modifiers", psm: "11", whitelist: ""})
	mods = extractModifiers(modifierText)

	// "DEMOTION PROTECTION" — a shield pill in the modifier row (a loss that
	// didn't drop the tier). It rides the modifiers list (already persisted via
	// the rank_modifiers table) rather than a bespoke field. Match on the
	// "DEMOTION" stem: old-UI OCR can lose everything after the stem (a real
	// capture reads "< DEMOTION || a || Pe"), and the 2026-07 UI's chip
	// renders as bare "DEMOTION" — whether that's a relabel of protection or
	// a distinct demoted-this-game chip is unproven (the one capture sat at
	// 52% progress, so no demotion visibly occurred). Until a capture shows
	// an actual demotion's chip, both map here; splitting on text alone
	// inverts the old UI's meaning when the tail truncates.
	if strings.Contains(strings.ToUpper(modifierText), "DEMOTION") {
		mods = append(mods, "demotion protection")
	}
	return mods, modifierText
}

// rankSRPanel reads the right-side per-hero SR card stack: hero portrait +
// "HERO SR" + 4-digit SR + signed change. The card sits ~85-99% across,
// mid-height. The panel holds up to three stacked cards; the bottom reaches
// 75% (not 55/66%) so the third card — pushed down by a demotion screen's
// extra row — is still inside the crop and its hero is recognized at all.
// The top card's hero becomes the match's primary hero + role.
func rankSRPanel(img image.Image, work string, res *MatchResult) {
	bounds := img.Bounds()
	W, H := bounds.Dx(), bounds.Dy()
	srRect := image.Rect(W*82/100, H*22/100, W*99/100, H*75/100)
	srText, _ := ocrInverted(img, srRect, ocrSpec{workDir: work, name: "rank_sr", psm: "11", whitelist: ""})
	res.SR = extractSR(srText)
	if anyZeroSR(res.SR) {
		backfillSRDigits(res.SR, img, work, W, H)
	}
	if len(res.SR) > 0 {
		res.Hero = res.SR[0].Hero
		if r, ok := loadDataset().heroRoles[res.Hero]; ok {
			res.Role = r
		}
	}
}

// rankTierWhitelist constrains the PSM-6 tier re-read to tier words, the
// 1-5 level digits, and the RANK PROGRESS caption's own characters — an
// alphabet with no letter the stylized numerals can escape into.
const rankTierWhitelist = "ABCDEFGHIJKLMNOPQRSTUVWXYZ12345:% "

// rankFuzzyMaxPct caps the tier-snap Levenshtein distance as a percentage of the
// tier name's length (floor of 1, mirroring snapToKnownMap). It lets a mis-OCR'd
// tier word recover from a glyph slip — "GOD"→gold, "CHAMPON"→champion — without
// matching unrelated words ("WIZARD" stays unmatched). This is the #499
// generalization lever: untested tiers (Bronze/Champion/Diamond) survive
// imperfect OCR instead of silently returning no rank.
const rankFuzzyMaxPct = 25

var rankWordRe = regexp.MustCompile(`[a-z]+`)

// snapTier resolves the OCR'd tier band to a canonical tier. An exact substring
// match wins; otherwise the nearest known tier (by Levenshtein distance, within
// the length-scaled threshold) to any alphabetic word in the text. It also
// returns the matched text token, so the level read can anchor on the
// (possibly garbled) word rather than the canonical tier.
func snapTier(lower string) (tier, word string) {
	for _, r := range loadDataset().ranks {
		if strings.Contains(lower, r) {
			return r, r
		}
	}
	bestDist := -1
	for _, w := range rankWordRe.FindAllString(lower, -1) {
		// 3 is the floor so a dropped-letter "GOD" can still reach the 4-char
		// "gold"; shorter words can't clear any tier's threshold, and longer
		// tiers exclude a 3-char word by length difference alone.
		if len(w) < 3 {
			continue
		}
		for _, r := range loadDataset().ranks {
			threshold := max(len(r)*rankFuzzyMaxPct/100, 1)
			if d := levenshtein(w, r); d <= threshold && (bestDist < 0 || d < bestDist) {
				bestDist, tier, word = d, r, w
			}
		}
	}
	return tier, word
}

func extractRank(text string) (string, int) {
	rank, word := snapTier(strings.ToLower(text))
	if rank == "" {
		return "", 0
	}
	// Anchor the level on the matched tier word (the canonical tier on an exact
	// hit, the garbled token when fuzzy-snapped). Allow digit-lookalike letters
	// after it ("GOLD I" — the italic "1" OCRs as the letter I) and digitize
	// before reading. Take the LAST digit of the trailing run: italic fonts
	// misread "PLATINUM 5" as "PLATINUM 35", and OW levels are single digits 1-5.
	level := 0
	re := regexp.MustCompile(`(?i)` + regexp.QuoteMeta(word) + `\s*([0-9OoQqIlL]+)`)
	if m := re.FindStringSubmatch(text); m != nil {
		d := digitize(m[1])
		level, _ = strconv.Atoi(d[len(d)-1:])
	}
	return rank, level
}

// resultFromModifiers picks the win/loss/draw modifier out of the rank-screen
// pills — the fallback when the top-left banner OCR is too mangled to classify.
func resultFromModifiers(mods []string) string {
	for _, m := range mods {
		switch m {
		case "victory", "defeat", "draw":
			return m
		}
	}
	return ""
}

func extractModifiers(text string) []string {
	lower := strings.ToLower(text)
	seen := map[string]bool{}
	var found []string
	for _, m := range knownModifiers() {
		if strings.Contains(lower, m) && !seen[m] {
			found = append(found, m)
			seen[m] = true
		}
	}
	return found
}

var (
	srValueRe  = regexp.MustCompile(`\b(\d{4})\b`)
	srChangeRe = regexp.MustCompile(`\d{1,3}`)
	srRunRe    = regexp.MustCompile(`\d{4,5}`)
)

// extractSR pulls (hero, SR, change-magnitude) from the right-side SR panel OCR.
// The panel stacks one card per hero — "<HERO> SR <4-digit SR> <change>" — so a
// hero's numbers sit between its name and the next hero's. We walk heroes in the
// order they appear and read each one's SR + change from its OWN text window.
//
// (The old code grabbed the FIRST 4-digit run in the whole blob for EVERY hero,
// so leading noise — e.g. "4100" bleeding in from the role-SR area, or the first
// card's value — was copied onto all of them, collapsing two distinct cards to a
// single wrong SR.) The change's sign (green up-arrow vs red down-arrow) isn't in
// the OCR text; parseRank derives it from the match result, so we capture the
// magnitude here. digitize() recovers the OW font's O/Q/I/l/L → digit confusion.
func extractSR(text string) []HeroSR {
	heroes := extractHeroes(text)
	if len(heroes) == 0 {
		return nil
	}
	lower := asciiLower(text)
	type card struct {
		hero string
		at   int
	}
	cards := make([]card, 0, len(heroes))
	for _, h := range heroes {
		at := strings.Index(lower, h)
		if at < 0 {
			at = len(lower) // unmatched name → sort last, claims the trailing window
		}
		cards = append(cards, card{h, at})
	}
	sort.SliceStable(cards, func(i, j int) bool { return cards[i].at < cards[j].at })

	out := make([]HeroSR, 0, len(cards))
	for i, c := range cards {
		end := len(text)
		if i+1 < len(cards) {
			end = cards[i+1].at
		}
		orig := text[c.at:end]
		// digitize (length-preserving) recovers O/Q/I/l/L → digit confusion so the
		// 4-digit SR run reads; the change reads from the ORIGINAL slice at the same
		// offsets, since digitizing there would mint false digits out of the card's
		// stray letters (an "Le" decoration becoming "1e" → a phantom change of 1).
		seg := digitize(orig)
		entry := HeroSR{Hero: c.hero}
		if m := srValueRe.FindStringSubmatchIndex(seg); m != nil {
			entry.SR, _ = strconv.Atoi(seg[m[2]:m[3]])
			if m2 := srChangeRe.FindString(orig[m[1]:]); m2 != "" {
				entry.Change, _ = strconv.Atoi(m2)
			}
		}
		out = append(out, entry)
	}
	return out
}

// asciiLower folds A-Z byte for byte, leaving every other byte alone.
// extractSR needs a lowercase copy whose byte offsets still address the
// ORIGINAL text, and strings.ToLower is not length-preserving: U+0130 (İ)
// lowercases to a 1-byte "i" and U+023A (Ⱥ) to a 3-byte "ⱥ", so one cased
// multi-byte rune ahead of the cards shifts every later offset — sliding a
// card's window (a silently wrong SR change) or running it past the end of
// the string (a slice-bounds panic that kills the parse). Hero keys are
// ASCII after normalize(), so an ASCII-only fold still finds all of them.
func asciiLower(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			b[i] = c + ('a' - 'A')
		}
	}
	return string(b)
}

func anyZeroSR(srs []HeroSR) bool {
	for _, s := range srs {
		if s.SR == 0 {
			return true
		}
	}
	return false
}

// backfillSRDigits recovers cards the sparse pass zeroed by digit-forcing a
// re-OCR of the card region — starting below the rank-progress caption to skip
// its "100" noise. Recovered SR-range values are assigned, in reading order,
// to the still-zero cards; a value already read from the card text is kept and
// excluded from the candidate pool so it can't be double-assigned.
func backfillSRDigits(srs []HeroSR, img image.Image, work string, w, h int) {
	region := image.Rect(w*82/100, h*28/100, w*99/100, h*75/100)
	assigned := map[int]bool{}
	for _, s := range srs {
		if s.SR != 0 {
			assigned[s.SR] = true
		}
	}
	cands := srDigitCandidates(img, work, region, assigned)
	ci := 0
	for i := range srs {
		if srs[i].SR == 0 && ci < len(cands) {
			srs[i].SR = cands[ci]
			ci++
		}
	}
}

// srDigitCandidates digit-force re-OCRs the card region under two
// page-segmentation modes. Stacked cards read differently under each mode
// (one card's digits surface under PSM 6 while a neighbor's only appear under
// PSM 3), so the union recovers more than either alone. Returns the plausible
// SR values not already assigned to a card, in reading order, deduplicated.
func srDigitCandidates(img image.Image, work string, region image.Rectangle, assigned map[int]bool) []int {
	seen := map[int]bool{}
	var cands []int
	for _, psm := range []string{"6", "3"} {
		text, _ := ocrInverted(img, region, ocrSpec{workDir: work, name: "rank_sr_digits_" + psm, psm: psm, whitelist: "0123456789"})
		for _, run := range srRunRe.FindAllString(text, -1) {
			v := srFromRun(run)
			if v == 0 || assigned[v] || seen[v] {
				continue
			}
			seen[v] = true
			cands = append(cands, v)
		}
	}
	return cands
}

// srFromRun reduces an OCR digit run to a plausible 4-digit SR (1000-4999). A
// 5-digit run is a 4-digit SR with one stray edge digit (the change-arrow glyph
// or the SR icon read as a digit); accept it only when exactly one edge-drop
// lands in range — if both do (e.g. a "2157"+"94" merge reading "21579") it's
// ambiguous and rejected rather than guessed.
func srFromRun(run string) int {
	inRange := func(v int) bool { return v >= 1000 && v < 5000 }
	switch len(run) {
	case 4:
		if v, _ := strconv.Atoi(run); inRange(v) {
			return v
		}
	case 5:
		lead, _ := strconv.Atoi(run[1:])
		trail, _ := strconv.Atoi(run[:4])
		switch {
		case inRange(lead) && !inRange(trail):
			return lead
		case inRange(trail) && !inRange(lead):
			return trail
		}
	}
	return 0
}

// chipTokenRe finds the ALL-CAPS runs a modifier chip is spelled in. Five
// characters minimum: the modifier band OCRs a lot of chrome noise from the
// pill icons ("Ge", "oe", "as", "ns", "nnn"), and every real chip word in the
// vocabulary is at least five letters.
var chipTokenRe = regexp.MustCompile(`[A-Z]{5,}`)

// recordUnknownChips preserves the modifier-row words this release's vocabulary
// cannot account for, so the evidence outlives the parse instead of living only
// in a log line nobody greps until the next season is already over.
func recordUnknownChips(res *MatchResult, band string) {
	toks := unknownChipTokens(band, StorableModifiers())
	if len(toks) == 0 {
		return
	}
	res.ModifiersRaw = strings.Join(toks, " ")
	for _, tok := range toks {
		applog.Subsystem("parser").Info("unrecognized rank modifier chip",
			"chip", tok, "hint", "modifiers.yaml may be behind the game")
	}
}

// unknownChipTokens returns the chip-like words in the modifier band that no
// known modifier accounts for. Callers pass StorableModifiers() rather than
// Modifiers(), so "demotion protection" — matched out-of-band from its
// DEMOTION stem — counts as known rather than as a discovery.
//
// The vocabulary is a closed list, so a chip it does not carry is dropped
// SILENTLY — which is how a whole season's new modifier goes unnoticed:
// "variance" shipped on every post-placement screen of the season-4 corpus and
// nothing anywhere said so. This turns that silence into a parse warning, which
// the app copies into the failed-files ledger so the capture surfaces in the
// Unknown tab for a deliberate look instead of counting as clean.
//
// Matching is deliberately generous in BOTH directions: a token counts as
// accounted-for if a known modifier contains it or it contains a known
// modifier. That absorbs the truncations this band is prone to ("CONSOLAT" for
// consolation) rather than reporting them as discoveries, at the cost of not
// reporting a genuinely new chip that happens to be a substring of an existing
// one — a trade worth making, because a warning nobody trusts is worse than no
// warning.
func unknownChipTokens(text string, known []string) []string {
	var out []string
	seen := map[string]bool{}
	for _, tok := range chipTokenRe.FindAllString(text, -1) {
		lower := strings.ToLower(tok)
		if seen[lower] {
			continue
		}
		accounted := false
		for _, m := range known {
			if strings.Contains(m, lower) || strings.Contains(lower, m) {
				accounted = true
				break
			}
		}
		if !accounted {
			seen[lower] = true
			out = append(out, tok)
		}
	}
	return out
}
