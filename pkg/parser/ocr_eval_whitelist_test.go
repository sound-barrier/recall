package parser_test

import (
	"strings"
	"testing"
	"unicode"
)

// Fitting another engine's readings to a region's Tesseract whitelist, for
// the OCR engine evaluation (ocr_eval_test.go): the replay and the agreement
// scores both read an engine's text through it.

// A whitelist forces Tesseract onto its nearest allowed glyph, so another
// engine's reading is mapped the same way before anything outside the
// whitelist is dropped: a "1O5" in a digits-only cell is 105, not 15.
func TestOCREval_FitsAReadingToTheWhitelistLikeTesseract(t *testing.T) {
	cases := []struct{ text, whitelist, want string }{
		{"1O5", "0123456789,", "105"},
		{"l2,S8B", "0123456789,", "12,588"},
		{"victory", "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "VICTORY"},
		{"R4NK 5", "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "RANK S"},
		{"12%", "0123456789", "12"},
		{"anything", "", "anything"},
	}
	for _, c := range cases {
		if got, _ := fitToWhitelist("wmo-pre", c.text, c.whitelist); got != c.want {
			t.Errorf("fitToWhitelist(%q, %q) = %q, want %q", c.text, c.whitelist, got, c.want)
		}
	}
	if got, _ := fitToWhitelist(baselineEngine, "1O5", "0123456789"); got != "1O5" {
		t.Errorf("Tesseract's own reading was refitted to %q; its whitelist already applied", got)
	}
}

// whitelistConfusables are the glyphs each character is most often misread
// as, in the order Tesseract's whitelist would settle on them.
var whitelistConfusables = map[rune]string{
	'O': "0", 'o': "0", 'Q': "0", 'q': "0", 'D': "0",
	'I': "1", 'i': "1", 'l': "1", 'L': "1", '|': "1", '!': "1",
	'Z': "2", 'z': "2", 'S': "5", 's': "5", 'G': "6", 'B': "8",
	'0': "O", '1': "I", '2': "Z", '4': "A", '5': "S", '6': "G", '8': "B",
}

// fitToWhitelist settles another engine's reading onto a region's Tesseract
// character whitelist, as an integration of it would have to: Windows OCR
// takes no whitelist, and the parser's digit passes rely on one. Tesseract
// with a whitelist forces each glyph to its nearest allowed class rather
// than dropping it, so a character outside the whitelist becomes its other
// case or its usual confusion when that is allowed, and is dropped only
// when nothing is. edits counts the characters changed or dropped.
func fitToWhitelist(engine, text, whitelist string) (fitted string, edits int) {
	if whitelist == "" || strings.HasPrefix(engine, baselineEngine) {
		return text, 0
	}
	fitted = strings.Map(func(r rune) rune {
		allowed := nearestAllowed(r, whitelist)
		if allowed != r {
			edits++
		}
		return allowed
	}, text)
	return fitted, edits
}

func nearestAllowed(r rune, whitelist string) rune {
	if r == '\n' || r == ' ' || strings.ContainsRune(whitelist, r) {
		return r
	}
	for _, c := range string(unicode.ToUpper(r)) + string(unicode.ToLower(r)) + whitelistConfusables[r] {
		if strings.ContainsRune(whitelist, c) {
			return c
		}
	}
	return -1
}
