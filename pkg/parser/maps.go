package parser

import "strings"

// knownMaps is the OW map list, used to fix Tesseract misreads on map names
// by snapping the OCR result to the closest match.
var knownMaps = []string{
	"aatlis", "antarctic peninsula", "blizzard world", "busan", "circuit royal",
	"colosseo", "dorado", "esperanca", "eichenwalde", "havana", "hollywood",
	"horizon lunar colony", "ilios", "junkertown", "king's row", "lijiang tower",
	"midtown", "nepal", "new junk city", "new queen street", "numbani",
	"oasis", "paraiso", "rialto", "route 66", "runasapi", "samoa", "shambali monastery",
	"suravasa", "throne of anubis", "watchpoint: gibraltar", "volskaya industries",
}

// snapToKnownMap returns the known OW map whose lowercase name is closest to
// the OCR'd string by Levenshtein distance, but only if the match is decent
// (distance below ~40% of the candidate length). Otherwise it returns the input
// unchanged so genuinely-unknown maps don't get rewritten to the wrong thing.
func snapToKnownMap(ocr string) string {
	best := ocr
	bestDist := -1
	for _, m := range knownMaps {
		d := levenshtein(ocr, m)
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
// like "© HYBRID - COMPETITIVE] HOLLYWooD [/MF'7:/]5".
func bestKnownMapInText(text string) string {
	lower := strings.ToLower(text)
	bestMap := ""
	bestDist := -1
	for _, m := range knownMaps {
		if len(m) > len(lower) {
			continue
		}
		threshold := len(m) * 3 / 10
		if threshold < 1 {
			threshold = 1
		}
		for i := 0; i+len(m) <= len(lower); i++ {
			d := levenshtein(lower[i:i+len(m)], m)
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
