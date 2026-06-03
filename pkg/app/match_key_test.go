package app

import (
	"errors"
	"testing"
)

func TestParseMatchKey_KnownPrefixes(t *testing.T) {
	cases := []struct {
		input    string
		wantKind MatchKeyKind
		wantBody string
	}{
		{"match-2026-05-10T22-21-11", KindTracked, "2026-05-10T22-21-11"},
		{"unmatched-some-file.png", KindUnmatched, "some-file.png"},
		{"ambiguous-other-file.png", KindAmbiguous, "other-file.png"},
	}
	for _, c := range cases {
		t.Run(c.input, func(t *testing.T) {
			got, err := ParseMatchKey(c.input)
			if err != nil {
				t.Fatalf("err = %v, want nil", err)
			}
			if got.Kind != c.wantKind {
				t.Errorf("Kind = %v, want %v", got.Kind, c.wantKind)
			}
			if got.Body != c.wantBody {
				t.Errorf("Body = %q, want %q", got.Body, c.wantBody)
			}
			if got.String() != c.input {
				t.Errorf("String() = %q, want round-trip %q", got.String(), c.input)
			}
		})
	}
}

func TestParseMatchKey_UnknownPrefixReturnsSentinel(t *testing.T) {
	cases := []string{
		"",
		"matchx-not-real",
		"random-string",
		"matchcolonbutnodash:abc",
	}
	for _, c := range cases {
		t.Run(c, func(t *testing.T) {
			_, err := ParseMatchKey(c)
			if !errors.Is(err, ErrInvalidMatchKey) {
				t.Errorf("err = %v, want ErrInvalidMatchKey", err)
			}
		})
	}
}

func TestMatchKey_KindHelpers(t *testing.T) {
	m, _ := ParseMatchKey("match-2026-01-01T00-00-00")
	if !m.IsTracked() || m.IsAmbiguous() || m.IsUnmatched() {
		t.Error("IsTracked helper misclassified a match- key")
	}
	a, _ := ParseMatchKey("ambiguous-x.png")
	if !a.IsAmbiguous() || a.IsTracked() || a.IsUnmatched() {
		t.Error("IsAmbiguous helper misclassified an ambiguous- key")
	}
	u, _ := ParseMatchKey("unmatched-x.png")
	if !u.IsUnmatched() || u.IsTracked() || u.IsAmbiguous() {
		t.Error("IsUnmatched helper misclassified an unmatched- key")
	}
}

func TestMatchKey_Filename(t *testing.T) {
	a, _ := ParseMatchKey("ambiguous-foo.png")
	if got := a.Filename(); got != "foo.png" {
		t.Errorf("ambiguous.Filename() = %q, want %q", got, "foo.png")
	}
	u, _ := ParseMatchKey("unmatched-bar.png")
	if got := u.Filename(); got != "bar.png" {
		t.Errorf("unmatched.Filename() = %q, want %q", got, "bar.png")
	}
	m, _ := ParseMatchKey("match-2026-01-01T00-00-00")
	if got := m.Filename(); got != "" {
		t.Errorf("tracked.Filename() = %q, want empty (tracked keys are time-derived)", got)
	}
}

// TestMatchKey_RoundTrip is the cross-cutting guard that wire-format
// match_key strings produced by the three constructors round-trip
// through ParseMatchKey → String() unchanged. A drift here means a
// minting site and a parsing site disagree on the wire shape — the
// exact failure mode the typed identity was introduced to make
// impossible.
func TestMatchKey_RoundTrip(t *testing.T) {
	cases := []MatchKey{
		NewTrackedMatchKey("2026-05-10T22-21-11"),
		NewUnmatchedMatchKey("some-screenshot.png"),
		NewAmbiguousMatchKey("other-screenshot.png"),
	}
	for _, c := range cases {
		t.Run(c.String(), func(t *testing.T) {
			parsed, err := ParseMatchKey(c.String())
			if err != nil {
				t.Fatalf("re-parse %q: %v", c.String(), err)
			}
			if parsed.Kind != c.Kind {
				t.Errorf("Kind drift: got %v, want %v", parsed.Kind, c.Kind)
			}
			if parsed.Body != c.Body {
				t.Errorf("Body drift: got %q, want %q", parsed.Body, c.Body)
			}
			if parsed.Raw != c.Raw {
				t.Errorf("Raw drift: got %q, want %q", parsed.Raw, c.Raw)
			}
			if parsed.String() != c.String() {
				t.Errorf("String() drift: got %q, want %q", parsed.String(), c.String())
			}
		})
	}
}

func TestNewAmbiguousMatchKey_BuildsParseable(t *testing.T) {
	k := NewAmbiguousMatchKey("foo bar.png") // space in filename — still safe
	if !k.IsAmbiguous() {
		t.Error("NewAmbiguousMatchKey did not produce a Kind=Ambiguous key")
	}
	if k.Filename() != "foo bar.png" {
		t.Errorf("Filename() = %q, want %q", k.Filename(), "foo bar.png")
	}
}
