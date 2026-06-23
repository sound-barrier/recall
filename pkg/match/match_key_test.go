package match_test

import (
	"errors"
	"regexp"
	"testing"

	"recall/pkg/match"
)

func TestParseMatchKey_KnownPrefixes(t *testing.T) {
	cases := []struct {
		input    string
		wantKind match.MatchKeyKind
		wantBody string
	}{
		{"match-2026-05-10T22-21-11", match.KindTracked, "2026-05-10T22-21-11"},
		{"unmatched-some-file.png", match.KindUnmatched, "some-file.png"},
		{"ambiguous-other-file.png", match.KindAmbiguous, "other-file.png"},
	}
	for _, c := range cases {
		t.Run(c.input, func(t *testing.T) {
			got, err := match.ParseMatchKey(c.input)
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
			_, err := match.ParseMatchKey(c)
			if !errors.Is(err, match.ErrInvalidMatchKey) {
				t.Errorf("err = %v, want ErrInvalidMatchKey", err)
			}
		})
	}
}

func TestMatchKey_KindHelpers(t *testing.T) {
	m, _ := match.ParseMatchKey("match-2026-01-01T00-00-00")
	if !m.IsTracked() || m.IsAmbiguous() || m.IsUnmatched() {
		t.Error("IsTracked helper misclassified a match- key")
	}
	a, _ := match.ParseMatchKey("ambiguous-x.png")
	if !a.IsAmbiguous() || a.IsTracked() || a.IsUnmatched() {
		t.Error("IsAmbiguous helper misclassified an ambiguous- key")
	}
	u, _ := match.ParseMatchKey("unmatched-x.png")
	if !u.IsUnmatched() || u.IsTracked() || u.IsAmbiguous() {
		t.Error("IsUnmatched helper misclassified an unmatched- key")
	}
}

func TestMatchKey_Filename(t *testing.T) {
	a := match.NewAmbiguousMatchKey("foo.png")
	if got := a.Filename(); got != "foo.png" {
		t.Errorf("ambiguous.Filename() = %q, want %q", got, "foo.png")
	}
	u := match.NewUnmatchedMatchKey("bar.png")
	if got := u.Filename(); got != "bar.png" {
		t.Errorf("unmatched.Filename() = %q, want %q", got, "bar.png")
	}
	m, _ := match.ParseMatchKey("match-2026-01-01T00-00-00")
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
	cases := []match.MatchKey{match.NewTrackedMatchKey("2026-05-10T22-21-11"), match.NewUnmatchedMatchKey("some-screenshot.png"), match.NewAmbiguousMatchKey("other-screenshot.png")}
	for _, c := range cases {
		t.Run(c.String(), func(t *testing.T) {
			parsed, err := match.ParseMatchKey(c.String())
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
	k := match.NewAmbiguousMatchKey("foo bar.png") // space in filename — still safe
	if !k.IsAmbiguous() {
		t.Error("NewAmbiguousMatchKey did not produce a Kind=Ambiguous key")
	}
	if k.Filename() != "foo bar.png" {
		t.Errorf("Filename() = %q, want %q", k.Filename(), "foo bar.png")
	}
}

// TestSentinelKeys_URLSafeRoundTrip is the contract for the URL-safe sentinel
// encoding: the unmatched/ambiguous keys carry no characters that need
// percent-encoding in a path, and any filename — spaces, parens, dots, unicode —
// round-trips through the key via Filename().
func TestSentinelKeys_URLSafeRoundTrip(t *testing.T) {
	urlSafe := regexp.MustCompile(`^(unmatched|ambiguous)-[A-Za-z0-9_-]+$`)
	filenames := []string{
		"Overwatch 2024.png",
		"My Screenshot (1).png",
		"スクリーンショット.png",
		"plain-file.png",
	}
	for _, fn := range filenames {
		for _, k := range []match.MatchKey{
			match.NewUnmatchedMatchKey(fn),
			match.NewAmbiguousMatchKey(fn),
		} {
			s := k.String()
			if !urlSafe.MatchString(s) {
				t.Errorf("key %q is not URL-safe (want match %v)", s, urlSafe)
			}
			parsed, err := match.ParseMatchKey(s)
			if err != nil {
				t.Fatalf("re-parse %q: %v", s, err)
			}
			if got := parsed.Filename(); got != fn {
				t.Errorf("Filename() round-trip = %q, want %q", got, fn)
			}
		}
	}
}
