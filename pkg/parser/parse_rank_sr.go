package parser

import (
	"image"
	"regexp"
	"slices"
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
	if len(res.SR) == 0 {
		// A bright hero model behind the cards inverts to noise. A 235
		// threshold keeps the white hero names and SR digits; the red/green
		// change digits do not survive it, so those changes stay unread (nil)
		// rather than picking up a neighbor's stray digit.
		srText, _ = ocrThreshold(img, srRect, ocrSpec{workDir: work, name: "rank_sr_occluded", scale: 3, thresh: 235, psm: "11"})
		res.SR = withoutChanges(extractSR(srText))
	}
	for _, card := range res.SR {
		if card.SR != 0 {
			res.recordEvidence(img, SRPath(card.Hero), srRect)
		}
	}
	if anyZeroSR(res.SR) {
		backfillSRDigits(res, img, work)
	}
	crossCheckSRCards(img, res, srText)
	if len(res.SR) > 0 {
		res.Hero = res.SR[0].Hero
		res.recordEvidence(img, ScalarPath("hero"), srRect)
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
		at, placed := srNameOffset(lower, h)
		if !placed {
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
				if n, err := strconv.Atoi(m2); err == nil {
					entry.Change = &n
				}
			}
		}
		out = append(out, entry)
	}
	return out
}

// srNameOffset is where hero's name starts in the panel text, folded by
// asciiLower. A name extractHeroes recognized only once its diacritics were
// stripped ("LÚCIO") is not found, and is not placed.
func srNameOffset(lower, hero string) (int, bool) {
	at := strings.Index(lower, hero)
	return at, at >= 0
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

func withoutChanges(srs []HeroSR) []HeroSR {
	for i := range srs {
		srs[i].Change = nil
	}
	return srs
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
// excluded from the candidate pool so it can't be double-assigned. A card it
// fills records the re-read's region as its evidence.
func backfillSRDigits(res *MatchResult, img image.Image, work string) {
	bounds := img.Bounds()
	w, h := bounds.Dx(), bounds.Dy()
	region := image.Rect(w*82/100, h*28/100, w*99/100, h*75/100)
	srs := res.SR
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
			res.recordEvidence(img, SRPath(srs[i].Hero), region)
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

// crossCheckSRCards tightens each SR card's evidence from the panel to the
// card's digits, with what the digit templates read there. Cards pair with res.SR in
// reading order, so only when that order is the cards' own: every name was
// found where panelText printed it (extractSR sorts one it cannot place
// last), and the frames found match the cards read one for one, since a card
// whose name OCR missed would shift every pairing below it.
func crossCheckSRCards(img image.Image, res *MatchResult, panelText string) {
	cards := srCards(img)
	if len(cards) != len(res.SR) || !everySRNamePlaced(panelText, res.SR) {
		return
	}
	for i, card := range cards {
		if box, ok := srDigitBox(img, card); ok && res.SR[i].SR != 0 {
			res.recordCrossChecked(img, SRPath(res.SR[i].Hero), box, numberTemplate(img, box))
		}
	}
}

func everySRNamePlaced(panelText string, sr []HeroSR) bool {
	lower := asciiLower(panelText)
	return !slices.ContainsFunc(sr, func(card HeroSR) bool {
		_, placed := srNameOffset(lower, card.Hero)
		return !placed
	})
}

// srCards finds each SR card's portrait, top to bottom, by the cyan hexagon
// framing it. A column through the frame's left flat side crosses one cyan
// run per card; on a pointy-top hexagon that side is half the height, so the
// run (76 px at 1440p) is centered on a portrait 135 px tall and 117 wide.
func srCards(img image.Image) []image.Rectangle {
	w, h := img.Bounds().Dx(), img.Bounds().Dy()
	x := w * 2350 / 2560
	sides := inkSpans(h, func(y int) bool {
		return isFrameCyan(img, x-1, y) || isFrameCyan(img, x, y) || isFrameCyan(img, x+1, y)
	})
	var cards []image.Rectangle
	for _, side := range sides {
		if side.length() < h*40/1440 {
			continue // a fleck of cyan in the hero art, not a frame
		}
		height, width := side.length()*135/76, side.length()*117/76
		left, top := w*2355/2560, (side.from+side.to)/2-height/2
		cards = append(cards, image.Rect(left, top, left+width, top+height))
	}
	return cards
}

func isFrameCyan(img image.Image, x, y int) bool {
	r, g, b, _ := img.At(x, y).RGBA()
	r8, g8, b8 := r>>8, g>>8, b>>8
	return r8 < 60 && g8 > 150 && g8 < 230 && b8 > 220
}

// srDigitCount is how many digits an SR prints: srValueRe reads exactly four.
const srDigitCount = 4

// srDigitBox is a card's SR digits. The card stacks hero name, SR and change
// left of the portrait, and the SR's row, led by the rank icon, is the
// tallest band of ink in that text column. Within the row the icon stands
// taller than the digits, or as tall, and a column of placement pips may
// trail them; the pips are stacked squares, never solid. So the SR is the
// last four solid blobs of the row's common height, when all four are
// digit-shaped: an icon fused to the first digit is not, and leaves the card
// unchecked.
func srDigitBox(img image.Image, card image.Rectangle) (image.Rectangle, bool) {
	w := card.Dx()
	text := image.Rect(card.Min.X-w*150/117, card.Min.Y, card.Min.X-w*50/117, card.Max.Y)
	band, ok := newInkGrid(img, text).tallestBand()
	if !ok {
		return image.Rectangle{}, false
	}
	row := image.Rect(card.Min.X-w*3/2, band.Min.Y, card.Min.X-w/10, band.Max.Y)
	digits := commonHeightBlobs(newInkGrid(img, row).blobs())
	if len(digits) < srDigitCount {
		return image.Rectangle{}, false
	}
	var box image.Rectangle
	for _, d := range digits[len(digits)-srDigitCount:] {
		if d.Dx() > d.Dy() {
			return image.Rectangle{}, false
		}
		box = box.Union(d)
	}
	return box.Inset(-inkPad(img)), true
}

// commonHeightBlobs keeps the solid blobs within a fifth of the median solid
// blob's height: the digits, which outnumber whatever else shares their row.
func commonHeightBlobs(blobs []blob) []image.Rectangle {
	var solid []image.Rectangle
	for _, b := range blobs {
		if b.solid {
			solid = append(solid, b.box)
		}
	}
	if len(solid) == 0 {
		return nil
	}
	heights := make([]int, len(solid))
	for i, b := range solid {
		heights[i] = b.Dy()
	}
	slices.Sort(heights)
	median := heights[len(heights)/2]
	return slices.DeleteFunc(solid, func(b image.Rectangle) bool {
		return 5*max(b.Dy()-median, median-b.Dy()) > median
	})
}
