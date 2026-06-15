package parser

// knownMaps + mapGameModes + mapDisplayNames are populated in owdata.go's
// init() from pkg/parser/maps.yaml. Edit maps.yaml to add or rename
// a map.

// FirstKnownMapIn is the exported entry point for the boot
// re-aggregator. Given a raw OCR string previously rejected by
// bestKnownMapInText, re-runs the matcher against the CURRENT
// maps.yaml roster and returns the canonical match (or "").
func FirstKnownMapIn(rawMap string) string {
	if m := snapToKnownMap(rawMap); m != rawMap && m != "" {
		return m
	}
	return bestKnownMapInText(rawMap)
}

// MapGameMode returns the type ("control", "escort", "hybrid", …) for the
// given map name, or "" for an unknown map. Accepts any casing — input
// is normalized to the same key form mapGameModes was built with. Exported
// so the aggregator can resolve type at read time from the stored map
// name without persisting a redundant `type` column on every row.
func MapGameMode(mapName string) string {
	return loadDataset().mapGameModes[normalize(mapName)]
}

// snapToKnownMap returns the known OW map whose normalized name is
// closest to the OCR'd string by Levenshtein distance, but only if
// the match is decent (distance below ~15% of the candidate length).
// Otherwise it returns the input unchanged so genuinely-unknown maps
// don't get rewritten to the wrong thing. Caller is expected to pass
// already-OCR'd text; this function normalizes both sides via the
// same rule the lookup keys were built with.
//
// Map names < 5 chars (none today, but future-proofed) are exact-only
// for the same short-name false-positive class that bit the hero
// matcher (see heroes.go's Pass 2 length-gate). The 15% ratio is
// tighter than the historical 40% — a 12-char map name now admits
// 1 edit (was 4), 19 chars admits 2 (was 7). Keeps recovery for
// Tesseract noise on long map names while killing the "New Junk
// City" / "Junkertown" class of overlap.
const minMapFuzzyLen = 5

// mapFuzzyMatchPct caps the Levenshtein edit distance to a percentage
// of the candidate map's length. 15% is tighter than the historical
// 40% — a 12-char name now admits 1 edit (was 4), 19 chars admits 2
// (was 7). Tight enough to kill the "New Junk City" / "Junkertown"
// overlap class while still tolerating one Tesseract glyph slip per
// ~7 characters.
const mapFuzzyMatchPct = 15

func snapToKnownMap(ocr string) string {
	normOCR := normalize(ocr)
	best := ocr
	bestDist := -1
	for _, m := range loadDataset().knownMaps {
		if len(m) < minMapFuzzyLen {
			continue
		}
		threshold := len(m) * mapFuzzyMatchPct / 100
		d := levenshtein(normOCR, m)
		if d <= threshold && (bestDist < 0 || d < bestDist) {
			bestDist = d
			best = m
		}
	}
	return best
}

// bestKnownMapInText slides every known map name across the OCR text as a
// fuzzy substring match and returns the closest match (or "" if none clear the
// quality threshold). This handles map names embedded inside garbled headers
// like "© HYBRID - COMPETITIVE] HOLLYWooD [/MF'7:/]5". Both text and map
// names are normalized via the same rule (see owdata.go's normalize).
//
// Length-gate at minMapFuzzyLen + the same 15% ratio as snapToKnownMap.
// A min-1 threshold floor lets normal-length map names recover from a
// single OCR glyph slip; the gate keeps short OOV strings from
// accidentally matching a short map name.
func bestKnownMapInText(text string) string {
	normText := normalize(text)
	bestMap := ""
	bestDist := -1
	for _, m := range loadDataset().knownMaps {
		if len(m) < minMapFuzzyLen {
			continue
		}
		if len(m) > len(normText) {
			continue
		}
		threshold := max(len(m)*mapFuzzyMatchPct/100, 1)
		for i := 0; i+len(m) <= len(normText); i++ {
			d := levenshtein(normText[i:i+len(m)], m)
			if d <= threshold && (bestDist < 0 || d < bestDist) {
				bestDist = d
				bestMap = m
			}
		}
	}
	return bestMap
}

func levenshtein(a, b string) int {
	la, lb := len(a), len(b)
	if la == 0 {
		return lb
	}
	if lb == 0 {
		return la
	}
	prev := make([]int, lb+1)
	curr := make([]int, lb+1)
	for j := 0; j <= lb; j++ {
		prev[j] = j
	}
	for i := 1; i <= la; i++ {
		curr[0] = i
		for j := 1; j <= lb; j++ {
			cost := 1
			if a[i-1] == b[j-1] {
				cost = 0
			}
			del := prev[j] + 1
			ins := curr[j-1] + 1
			sub := prev[j-1] + cost
			curr[j] = min(ins, del, sub)
		}
		prev, curr = curr, prev
	}
	return prev[lb]
}
