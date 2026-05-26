package parser

// knownMaps + mapTypes + mapDisplayNames are populated in owdata.go's
// init() from pkg/parser/maps.yaml. Edit maps.yaml to add or rename
// a map.

// MapType returns the type ("control", "escort", "hybrid", …) for the
// given map name, or "" for an unknown map. Accepts any casing — input
// is normalized to the same key form mapTypes was built with. Exported
// so the aggregator can resolve type at read time from the stored map
// name without persisting a redundant `type` column on every row.
func MapType(mapName string) string {
	return mapTypes[normalize(mapName)]
}

// snapToKnownMap returns the known OW map whose normalized name is
// closest to the OCR'd string by Levenshtein distance, but only if
// the match is decent (distance below ~40% of the candidate length).
// Otherwise it returns the input unchanged so genuinely-unknown maps
// don't get rewritten to the wrong thing. Caller is expected to pass
// already-OCR'd text; this function normalizes both sides via the
// same rule the lookup keys were built with.
func snapToKnownMap(ocr string) string {
	normOCR := normalize(ocr)
	best := ocr
	bestDist := -1
	for _, m := range knownMaps {
		d := levenshtein(normOCR, m)
		threshold := len(m) * 4 / 10
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
func bestKnownMapInText(text string) string {
	normText := normalize(text)
	bestMap := ""
	bestDist := -1
	for _, m := range knownMaps {
		if len(m) > len(normText) {
			continue
		}
		threshold := len(m) * 3 / 10
		if threshold < 1 {
			threshold = 1
		}
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
			m := del
			if ins < m {
				m = ins
			}
			if sub < m {
				m = sub
			}
			curr[j] = m
		}
		prev, curr = curr, prev
	}
	return prev[lb]
}
