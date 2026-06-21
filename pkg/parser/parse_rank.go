package parser

import (
	"image"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// knownRanks is the OW competitive tier list, used to snap OCR'd tier text.
var knownRanks = []string{
	"bronze", "silver", "gold", "platinum", "diamond",
	"master", "grandmaster", "champion",
}

// knownModifiers is the OW2 competitive rank-update modifier list — the
// small pills under the rank-progress bar that explain the SR change.
// The expectation-vs-outcome quartet (favoured×won = expected, favoured×lost
// = reversal, underdog×won = uphill battle, underdog×lost = consolation),
// the streak/calibration adjustments, and the result pill itself. Matched
// as substrings (multi-word labels included), so "win streak" and "loss
// streak" stay distinct. "demotion protection" is detected separately in
// parseRank (its OCR drops the trailing letters).
var knownModifiers = []string{
	"expected", "uphill battle", "reversal", "consolation",
	"win streak", "loss streak", "calibration", "volatile",
	"victory", "defeat", "draw",
}

// isRankScreenshot detects the post-match competitive RANK PROGRESS screen.
// "RANK PROGRESS" sits in the middle of the screen and is unique to this
// view (SUMMARY / TEAMS / PERSONAL never show it).
func isRankScreenshot(img image.Image, work string) bool {
	bounds := img.Bounds()
	W, H := bounds.Dx(), bounds.Dy()
	rect := image.Rect(W*10/100, H*55/100, W*70/100, H*78/100)
	text, err := ocrInverted(img, rect, work, "detect_rank", "11", "")
	if err != nil {
		return false
	}
	return strings.Contains(strings.ToUpper(text), "RANK PROGRESS")
}

// parseRank handles the post-match competitive rank screen: the tier badge
// (PLATINUM 5), the rank-progress bar with its change percentage, the match
// modifier pills (EXPECTED / VICTORY / etc.), and the per-hero SR + delta
// panel on the right. mode is forced to "competitive" because this screen
// only shows up for ranked play.
func parseRank(img image.Image, work string) (*MatchResult, error) {
	bounds := img.Bounds()
	W, H := bounds.Dx(), bounds.Dy()
	res := &MatchResult{Playlist: "competitive"}

	// Top-left banner: "COMPETITIVE VICTORY!" / "COMPETITIVE DEFEAT!" /
	// "COMPETITIVE DRAW!". Same prefix-match rule as the SUMMARY card so
	// OCR slips like "DEFERT" still classify.
	bannerRect := image.Rect(0, H*7/100, W*45/100, H*22/100)
	bannerText, _ := ocrInverted(img, bannerRect, work, "rank_banner", "11", "")
	upper := strings.ToUpper(bannerText)
	switch {
	case strings.Contains(upper, "VICTOR"):
		res.Result = "victory"
	case strings.Contains(upper, "DEFE"):
		res.Result = "defeat"
	case strings.Contains(upper, "DRAW") || strings.Contains(upper, "DRAU"):
		res.Result = "draw"
	}

	// Tier label: "PLATINUM 5" text sits just below the badge in the center
	// (Y≈60-68% of H — the badge itself takes the band above it).
	tierRect := image.Rect(W*30/100, H*58/100, W*70/100, H*70/100)
	tierText, _ := ocrInverted(img, tierRect, work, "rank_tier", "11", "")
	res.Rank, res.Level = extractRank(tierText)

	// Rank progress bar — "RANK PROGRESS: 21%" caption plus a "+25%" delta
	// pill inside the bar. OCR both in one wider crop and pull each via its
	// own regex. The RANK PROGRESS value can be NEGATIVE on a demotion screen
	// ("-19%"); it's thin, colored text the inverted pass flattens, so OCR it
	// RAW at 6x over a tight value crop just right of the "RANK PROGRESS:"
	// label (whose width is fixed, so the value always starts at the same x).
	progValRect := image.Rect(W*36/100, H*71/100, W*52/100, H*78/100)
	progValText, _ := ocrRaw(img, progValRect, work, "rank_progress", 6, "7", "-0123456789%")
	if m := regexp.MustCompile(`(-?\d{1,3})\s*%`).FindStringSubmatch(progValText); m != nil {
		res.RankProgress, _ = strconv.Atoi(m[1])
	}
	// The "+N%" gain pill (green, inside the bar). The inverted pass reads it at
	// 1440p but flattens the thin colored pill at 1080p (it returns 0); fall
	// back to the same raw-at-6x treatment the (also thin, also colored) RANK
	// PROGRESS value needs, so the gain survives a downscaled capture.
	changeRect := image.Rect(W*10/100, H*60/100, W*70/100, H*80/100)
	changeRe := regexp.MustCompile(`\+\s*(\d{1,3})\s*%`)
	changeText, _ := ocrInverted(img, changeRect, work, "rank_change", "11", "")
	m := changeRe.FindStringSubmatch(changeText)
	if m == nil {
		// 1080p: the pill text is too small for the inverted pass, and over the
		// wide crop the larger "RANK PROGRESS:" caption dominates OCR. Isolate
		// just the pill band (below the caption, on the bar) and read it raw at
		// 6x so the thin colored pill survives the downscale.
		pillRect := image.Rect(W*30/100, H*76/100, W*52/100, H*83/100)
		rawText, _ := ocrThreshold(img, pillRect, work, "rank_change_raw", 6, 200, "6", "+0123456789%")
		m = changeRe.FindStringSubmatch(rawText)
	}
	if m != nil {
		res.ChangePercent, _ = strconv.Atoi(m[1])
	}

	// Modifier pills below the progress bar. The right edge reaches 72% (not 55%):
	// the pills are centered under the bar and drift right-of-center as rank
	// progress climbs, so a 55% cut clipped a lone "VICTORY" pill (and the tail of
	// multi-pill rows like the truncated "CONSOLAT[ION]") entirely. 72% stops short
	// of the right-hand rank-tier badge (~78%+), so no icon noise bleeds in.
	modifierRect := image.Rect(W*10/100, H*78/100, W*72/100, H*90/100)
	modifierText, _ := ocrInverted(img, modifierRect, work, "rank_modifiers", "11", "")
	res.Modifiers = extractModifiers(modifierText)

	// Right-side per-hero SR card: hero portrait + "HERO SR" + 4-digit SR +
	// signed change. The card sits ~85-99% across, mid-height. The panel holds up
	// to three stacked cards; the bottom reaches 75% (not 55/66%) so the third card
	// — pushed down by a demotion screen's extra row — is still inside the crop and
	// its hero is recognised at all.
	srRect := image.Rect(W*82/100, H*22/100, W*99/100, H*75/100)
	srText, _ := ocrInverted(img, srRect, work, "rank_sr", "11", "")
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

	// "DEMOTION PROTECTION" — a shield pill in the modifier row (a loss that
	// didn't drop the tier). It rides the modifiers list (already persisted via
	// the rank_modifiers table) rather than a bespoke field. OCR usually drops
	// the trailing "N", so match on the "DEMOTION" stem.
	if strings.Contains(strings.ToUpper(modifierText), "DEMOTION") {
		res.Modifiers = append(res.Modifiers, "demotion protection")
	}

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

func extractRank(text string) (string, int) {
	lower := strings.ToLower(text)
	rank := ""
	for _, r := range knownRanks {
		if strings.Contains(lower, r) {
			rank = r
			break
		}
	}
	level := 0
	// Anchor the level match on the rank name to avoid picking up unrelated
	// digits from icon noise (e.g. Tesseract reads italic decoration as
	// extra digits before the level). Take the LAST digit in the trailing
	// number-run after the rank — italic fonts often misread to insert a
	// leading digit (so "PLATINUM 5" OCRs as "PLATINUM 35"), and OW levels
	// are always 1-5 single digits.
	if rank != "" {
		// Allow digit-lookalike letters after the tier ("GOLD I" — the italic
		// "1" OCRs as the letter I) and digitize before reading the level.
		re := regexp.MustCompile(`(?i)` + rank + `\s*([0-9OoQqIlL]+)`)
		if m := re.FindStringSubmatch(text); m != nil {
			d := digitize(m[1])
			level, _ = strconv.Atoi(d[len(d)-1:])
		}
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
	for _, m := range knownModifiers {
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
	lower := strings.ToLower(text)
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
		orig := text[min(c.at, len(text)):end]
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
// its "100" noise — under two page-segmentation modes. Stacked cards read
// differently under each mode (one card's digits surface under PSM 6 while a
// neighbour's only appear under PSM 3), so the union recovers more than either
// alone. Recovered SR-range values are assigned, in reading order, to the
// still-zero cards; a value already read from the card text is kept and excluded
// from the candidate pool so it can't be double-assigned.
func backfillSRDigits(srs []HeroSR, img image.Image, work string, W, H int) {
	region := image.Rect(W*82/100, H*28/100, W*99/100, H*75/100)
	assigned := map[int]bool{}
	for _, s := range srs {
		if s.SR != 0 {
			assigned[s.SR] = true
		}
	}
	seen := map[int]bool{}
	var cands []int
	for _, psm := range []string{"6", "3"} {
		text, _ := ocrInverted(img, region, work, "rank_sr_digits_"+psm, psm, "0123456789")
		for _, run := range srRunRe.FindAllString(text, -1) {
			v := srFromRun(run)
			if v == 0 || assigned[v] || seen[v] {
				continue
			}
			seen[v] = true
			cands = append(cands, v)
		}
	}
	ci := 0
	for i := range srs {
		if srs[i].SR == 0 && ci < len(cands) {
			srs[i].SR = cands[ci]
			ci++
		}
	}
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
