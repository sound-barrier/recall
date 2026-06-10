package parser

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// extractHeader pulls (map, type, competitive) out of the OCR'd top banner.
// Source format: "PAYLOAD - COMPETITIVE | WATCHPOINT: GIBRALTAR"
//
// Tesseract often mangles individual letters, so the patterns are deliberately
// fuzzy: we look for the most distinctive substring of each keyword and accept
// common OCR substitutions (I/L/1, O/0, etc.).
func extractHeader(text string) (mapName, gameType, mode string) {
	upper := strings.ToUpper(text)

	// Mode: "MPETIT" is the most distinctive substring of "COMPETITIVE";
	// anything else (no match) leaves mode empty. The aggregator picks
	// `competitive` from a SUMMARY sibling when one exists — preferable
	// to guessing "quickplay" and locking in a wrong value at write time.
	for _, sig := range []string{"MPETIT", "ETITIV", "OMPETI"} {
		if strings.Contains(upper, sig) {
			mode = "competitive"
			break
		}
	}

	// Map: try the segment after "|" first (when Tesseract renders the pipe).
	// If that doesn't snap cleanly, slide every known map name across the full
	// header text and pick the one with the smallest Levenshtein distance —
	// this handles maps without ":" in their name and headers where Tesseract
	// mangles the pipe into "]" or similar.
	candidate := text
	if i := strings.LastIndex(text, "|"); i >= 0 && i < len(text)-1 {
		candidate = text[i+1:]
	}
	mapWordRe := regexp.MustCompile(`(?i)^[\sA-Za-z':]*`)
	candidate = mapWordRe.FindString(candidate)
	candidate = strings.ToLower(strings.TrimSpace(candidate))
	mapName = snapToKnownMap(candidate)
	if mapName == "" || mapName == candidate {
		mapName = bestKnownMapInText(text)
	}

	// Type: shared between the in-game banner and the summary card.
	gameType = extractGameType(upper)
	return mapName, gameType, mode
}

// typePatterns matches OW game types in OCR'd text. Each pattern allows the
// common I/L/1 and O/0 substitutions Tesseract produces on the OW fonts so a
// single mangled letter doesn't break the match.
var typePatterns = []struct {
	name string
	re   *regexp.Regexp
}{
	{"payload", regexp.MustCompile(`(?i)PAY[ILT1!|]?[O0]A?D?`)},
	{"control", regexp.MustCompile(`(?i)C[O0]N?T?R[O0]L`)},
	{"push", regexp.MustCompile(`(?i)\bPUSH\b`)},
	{"escort", regexp.MustCompile(`(?i)ESC[O0][RP]T`)},
	{"hybrid", regexp.MustCompile(`(?i)HY[BD]?R[I1]D`)},
	{"flashpoint", regexp.MustCompile(`(?i)FL[A4]SH`)},
	{"clash", regexp.MustCompile(`(?i)CL[A4]SH`)},
}

func extractGameType(text string) string {
	upper := strings.ToUpper(text)
	for _, p := range typePatterns {
		if p.re.MatchString(upper) {
			return p.name
		}
	}
	return ""
}

var intRe = regexp.MustCompile(`\d[\d,]*`)

func extractInts(text string) []int {
	matches := intRe.FindAllString(text, -1)
	out := make([]int, 0, len(matches))
	for _, m := range matches {
		m = strings.ReplaceAll(m, ",", "")
		if n, err := strconv.Atoi(m); err == nil {
			out = append(out, n)
		}
	}
	return out
}

// digitize converts the common letter→digit OCR substitutions back to digits.
// Only used on captures that the surrounding regex has already established
// should be numeric (e.g. final-score brackets), so we don't accidentally
// mangle real letters elsewhere.
func digitize(s string) string {
	r := strings.NewReplacer("O", "0", "o", "0", "Q", "0", "q", "0", "I", "1", "l", "1", "L", "1")
	return r.Replace(s)
}

// twoDigitYearPivot is the century used when normalizing a two-digit
// year from OW's MM/DD/YY date display. OW1 launched in 2016 and OW2
// in 2022; a "19/.../69" date would be implausible by ~50 years, so a
// hard +2000 is correct until ~2099. (At which point Recall is
// probably not the active concern.)
const twoDigitYearPivot = 2000

// normalizeDate converts the client's MM/DD/YY display format to ISO YYYY-MM-DD
// so DB rows sort chronologically. Two-digit years are assumed to be 2000+;
// OW didn't ship until 2022 so a "19/.../69" date is implausible.
func normalizeDate(d string) string {
	m := regexp.MustCompile(`(\d{1,2})/(\d{1,2})/(\d{2,4})`).FindStringSubmatch(d)
	if m == nil {
		return d
	}
	mm, _ := strconv.Atoi(m[1])
	dd, _ := strconv.Atoi(m[2])
	yy, _ := strconv.Atoi(m[3])
	if yy < 100 {
		yy += twoDigitYearPivot
	}
	return fmt.Sprintf("%04d-%02d-%02d", yy, mm, dd)
}

// trimShortBoundaryWords drops 1-3 character words from the start and end of
// the extracted label. Tesseract often glues icon-misread runs ("CS", "PP",
// "VA") to a real label like "SOUND BARRIERS PROVIDED" via a space; the real
// labels are always multi-word and each word is 5+ characters, so stripping
// short boundary words cheaply removes the noise without an icon allowlist.
func trimShortBoundaryWords(s string) string {
	words := strings.Fields(s)
	for len(words) > 1 && len(words[0]) <= 3 {
		words = words[1:]
	}
	for len(words) > 1 && len(words[len(words)-1]) <= 3 {
		words = words[:len(words)-1]
	}
	return strings.Join(words, " ")
}

// labelToKey turns an OCR'd uppercase label into a stable snake_case key.
func labelToKey(label string) string {
	lower := strings.ToLower(label)
	key := regexp.MustCompile(`[^a-z0-9]+`).ReplaceAllString(lower, "_")
	return strings.Trim(key, "_")
}
