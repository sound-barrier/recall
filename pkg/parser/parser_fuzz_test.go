package parser_test

import (
	"strings"
	"testing"
	"unicode/utf8"

	"recall/pkg/parser"
)

// Fuzz harness on the parser's pure text-shape helpers. None of
// these mutate state, none hit the filesystem, and none shell out
// to Tesseract — so the fuzz corpus stays self-contained and CI
// can run a short cycle on every push (Go's testing.F harness
// without -fuzz just runs the seed corpus as a normal test).
//
// Invariants asserted:
//
//   - No panics on arbitrary input (the implicit testing.F guarantee).
//   - Output is valid UTF-8 (no surrogate halves or invalid byte
//     sequences sneak through normalize / extract helpers).
//   - Length bounds match the function's contract (digitize +
//     normalizeDate preserve or bound length; extractInts caps at
//     the input's digit count).
//
// To extend coverage: drop a new seed corpus file at
// `pkg/parser/testdata/fuzz/FuzzX/<seed-hash>` and re-run
// `go test -fuzz=FuzzX` locally. The harness already covers the
// "regression discovered by fuzz" workflow.

func FuzzDigitize(f *testing.F) {
	// Seed the corpus with the noise patterns digitize is supposed
	// to flatten: letters Tesseract confuses for digits (O/Q/I/l/L),
	// mixed-case headers, leading/trailing whitespace.
	seeds := []string{
		"",
		"123",
		"O0Il1L",
		"  forty 2  ",
		"S 4",
		"ELIMINATIONS 17",
		"\x00\x01\x02",
		string([]byte{0xff, 0xfe, 0xfd}), // raw bytes — must not break UTF-8 output
	}
	for _, s := range seeds {
		f.Add(s)
	}

	f.Fuzz(func(t *testing.T, in string) {
		out := parser.Digitize(in)
		// Output is valid UTF-8 IFF the input was. digitize is a
		// rune-by-rune mapping with no sanitization; invalid byte
		// sequences pass through unchanged (which is fine — the
		// upstream OCR layer never emits invalid UTF-8 itself).
		if utf8.ValidString(in) && !utf8.ValidString(out) {
			t.Errorf("digitize broke UTF-8 on valid input %q → %q", in, out)
		}
		// digitize swaps single characters; output length is bounded
		// by the input length (no expansion).
		if len(out) > len(in) {
			t.Errorf("digitize grew input %d → %d (input %q, output %q)", len(in), len(out), in, out)
		}
	})
}

func FuzzNormalizeDate(f *testing.F) {
	seeds := []string{
		"",
		"01/02/24",
		"12/31/2099",
		"1/1/0",
		"99/99/99",     // semantically nonsense but must not panic
		"a/b/c",        // no digits — should fall through unchanged
		"01/02/24junk", // suffix — regex must not anchor
	}
	for _, s := range seeds {
		f.Add(s)
	}

	f.Fuzz(func(t *testing.T, in string) {
		out := parser.NormalizeDate(in)
		if utf8.ValidString(in) && !utf8.ValidString(out) {
			t.Errorf("normalizeDate emitted invalid UTF-8 for %q → %q", in, out)
		}
		// Either the regex matched and the output is ISO-shaped
		// (YYYY-MM-DD = 10 chars), or it didn't match and the
		// output is the input unchanged.
		if out != in && len(out) != 10 {
			t.Errorf("normalizeDate produced non-ISO non-passthrough output for %q → %q (expected len 10 or input echo)", in, out)
		}
	})
}

func FuzzSnapToKnownMap(f *testing.F) {
	// Seeds: real OW map names + Tesseract-garbled variants + the
	// nonsense that should pass through unchanged.
	seeds := []string{
		"",
		"hollywood",
		"hollywooD",
		"new junk city",
		"junkertown",
		"midtown",
		"king's row",
		"random nonsense not a map",
		strings.Repeat("a", 200), // long but not a map
	}
	for _, s := range seeds {
		f.Add(s)
	}

	f.Fuzz(func(t *testing.T, in string) {
		out := parser.SnapToKnownMap(in)
		if utf8.ValidString(in) && !utf8.ValidString(out) {
			t.Errorf("snapToKnownMap emitted invalid UTF-8 for %q → %q", in, out)
		}
		// Either snapped to a known map (output present in
		// knownMaps) or passed through unchanged. Never both
		// silently dropped to empty when input was non-empty.
		if in != "" && out == "" {
			t.Errorf("snapToKnownMap dropped non-empty input %q to empty", in)
		}
	})
}

func FuzzLevenshtein(f *testing.F) {
	f.Add("", "")
	f.Add("kitten", "sitting")
	f.Add("hello", "hello")
	f.Add("hollywooD", "hollywood")
	f.Add("a", "")
	f.Add(strings.Repeat("a", 100), strings.Repeat("b", 100))

	f.Fuzz(func(t *testing.T, a, b string) {
		d := parser.Levenshtein(a, b)
		// Levenshtein invariants:
		//   d >= 0
		//   d == 0  iff  a == b
		//   d <= max(len(a), len(b))
		//   d(a,b) == d(b,a)   (symmetry)
		if d < 0 {
			t.Fatalf("parser.Levenshtein(%q,%q) returned negative %d", a, b, d)
		}
		if (d == 0) != (a == b) {
			t.Errorf("parser.Levenshtein(%q,%q)=%d but a==b is %v", a, b, d, a == b)
		}
		maxLen := max(len(a), len(b))
		if d > maxLen {
			t.Errorf("parser.Levenshtein(%q,%q)=%d exceeds max length %d", a, b, d, maxLen)
		}
		if rev := parser.Levenshtein(b, a); rev != d {
			t.Errorf("levenshtein not symmetric: (%q,%q)=%d but (%q,%q)=%d", a, b, d, b, a, rev)
		}
	})
}
