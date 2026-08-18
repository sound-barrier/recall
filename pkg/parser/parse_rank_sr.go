package parser

import (
	"image"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// The per-hero SR panel down the right of a rank screen, and the digit
// recovery that reads it when the OW font defeats a straight OCR pass.

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
