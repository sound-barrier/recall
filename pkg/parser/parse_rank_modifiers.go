package parser

import (
	"image"
	"regexp"
	"slices"
	"strings"

	"recall/pkg/applog"
)

// The modifier chip row — the captions naming WHY the rank moved as much as it
// did, plus the record of the chips the vocabulary could not explain.

// knownModifiers is the substring-matched rank-update vocabulary, derived from
// modifiers.yaml. It used to be a literal slice here, restated by hand in two
// SQL CHECK lists and a frontend constant; all three drifted. See
// modifiers.go / modifiers.yaml — adding a modifier is a YAML edit.
//
// "demotion protection" is deliberately NOT in this list: its chip OCRs as a
// bare stem, so parseRank appends it out-of-band below. It IS in
// StorableModifiers(), which is what the schema must accept.
func knownModifiers() []string { return Modifiers() }

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
		// Known non-modifier UI that overlaps the row is DROPPED, not reported.
		// "ENDORSEMENT RECEIVED" is a post-match toast, and the OCR reads it
		// truncated ("ORSEMENT RECEIVED") — calling that unexplained text would
		// be false, since it is understood perfectly well; it just was never a
		// modifier. Matched in both directions for exactly that truncation.
		accounted := false
		for _, m := range append(slices.Clone(known), NotModifiers()...) {
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
