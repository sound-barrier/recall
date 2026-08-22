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
		wantKind match.KeyKind
		wantBody string
	}{
		{"match-2026-05-10T22-21-11", match.KindTracked, "2026-05-10T22-21-11"},
		{"unmatched-some-file.png", match.KindUnmatched, "some-file.png"},
		{"ambiguous-other-file.png", match.KindAmbiguous, "other-file.png"},
		{"replay-A1B2C3", match.KindReplay, "A1B2C3"},
	}
	for _, c := range cases {
		t.Run(c.input, func(t *testing.T) {
			got, err := match.ParseKey(c.input)
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
			_, err := match.ParseKey(c)
			if !errors.Is(err, match.ErrInvalidKey) {
				t.Errorf("err = %v, want ErrInvalidKey", err)
			}
		})
	}
}

// The four helpers partition the key space: each key answers true to exactly
// one of them. Table-driven so a fifth kind costs one row rather than another
// four-way boolean conjunction.
func TestMatchKey_KindHelpers(t *testing.T) {
	type probe struct {
		name string
		fn   func(match.Key) bool
	}
	probes := []probe{
		{"IsTracked", match.Key.IsTracked},
		{"IsUnmatched", match.Key.IsUnmatched},
		{"IsAmbiguous", match.Key.IsAmbiguous},
		{"IsReplay", match.Key.IsReplay},
	}
	cases := []struct{ input, wantTrue string }{
		{"match-2026-01-01T00-00-00", "IsTracked"},
		{"unmatched-x.png", "IsUnmatched"},
		{"ambiguous-x.png", "IsAmbiguous"},
		{"replay-A1B2C3", "IsReplay"},
	}
	for _, c := range cases {
		t.Run(c.input, func(t *testing.T) {
			k, err := match.ParseKey(c.input)
			if err != nil {
				t.Fatalf("ParseKey(%q): %v", c.input, err)
			}
			for _, p := range probes {
				if got, want := p.fn(k), p.name == c.wantTrue; got != want {
					t.Errorf("%s(%q) = %v, want %v", p.name, c.input, got, want)
				}
			}
		})
	}
}

// A replay key is the first kind the parser never mints: it is derived from
// six characters a coach types, on a machine that has none of the player's
// screenshots. That is the whole point — it is the only key two people can
// arrive at independently.
func TestNewReplayMatchKey_IsDerivedFromTheCodeAlone(t *testing.T) {
	k, ok := match.NewReplayMatchKey("  a1b2c3 ")
	if !ok {
		t.Fatal("NewReplayMatchKey rejected a valid code")
	}
	if k.String() != "replay-A1B2C3" {
		t.Errorf("key = %q, want replay-A1B2C3", k.String())
	}
	if k.ReplayCode() != "A1B2C3" {
		t.Errorf("ReplayCode() = %q, want A1B2C3", k.ReplayCode())
	}
	// Two people, two machines, one code — the same key or the feature is
	// broken.
	other, _ := match.NewReplayMatchKey("A1B2C3")
	if other.String() != k.String() {
		t.Errorf("same code minted two keys: %q vs %q", k.String(), other.String())
	}
}

// There is exactly one door, and it refuses to mint a key from a code that
// is not one. A typo must not become a match nobody can find.
func TestNewReplayMatchKey_RefusesAMalformedCode(t *testing.T) {
	for _, code := range []string{"", "ABC", "TOOLONG7", "A1B2C!"} {
		if _, ok := match.NewReplayMatchKey(code); ok {
			t.Errorf("NewReplayMatchKey(%q) minted a key from a malformed code", code)
		}
	}
}

// ReplayCode is the Filename() sibling: it answers only for its own kind,
// so a caller that forgets to branch gets nothing rather than nonsense.
func TestMatchKey_ReplayCodeIsEmptyForOtherKinds(t *testing.T) {
	for _, raw := range []string{"match-2026-01-01T00-00-00", "unmatched-x.png", "ambiguous-x.png"} {
		k, _ := match.ParseKey(raw)
		if got := k.ReplayCode(); got != "" {
			t.Errorf("%s.ReplayCode() = %q, want empty", raw, got)
		}
	}
}

// A replay key has no filename behind it, the mirror of a tracked key having
// none: one is derived from a clock, the other from a code.
func TestMatchKey_ReplayHasNoFilename(t *testing.T) {
	k, _ := match.NewReplayMatchKey("A1B2C3")
	if got := k.Filename(); got != "" {
		t.Errorf("replay.Filename() = %q, want empty", got)
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
	m, _ := match.ParseKey("match-2026-01-01T00-00-00")
	if got := m.Filename(); got != "" {
		t.Errorf("tracked.Filename() = %q, want empty (tracked keys are time-derived)", got)
	}
}

// TestMatchKey_RoundTrip is the cross-cutting guard that wire-format
// match_key strings produced by the three constructors round-trip
// through ParseKey → String() unchanged. A drift here means a
// minting site and a parsing site disagree on the wire shape — the
// exact failure mode the typed identity was introduced to make
// impossible.
func TestMatchKey_RoundTrip(t *testing.T) {
	replayKey, _ := match.NewReplayMatchKey("A1B2C3")
	cases := []match.Key{match.NewTrackedMatchKey("2026-05-10T22-21-11"), match.NewUnmatchedMatchKey("some-screenshot.png"), match.NewAmbiguousMatchKey("other-screenshot.png"), replayKey}
	for _, c := range cases {
		t.Run(c.String(), func(t *testing.T) {
			parsed, err := match.ParseKey(c.String())
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
		for _, k := range []match.Key{
			match.NewUnmatchedMatchKey(fn),
			match.NewAmbiguousMatchKey(fn),
		} {
			s := k.String()
			if !urlSafe.MatchString(s) {
				t.Errorf("key %q is not URL-safe (want match %v)", s, urlSafe)
			}
			parsed, err := match.ParseKey(s)
			if err != nil {
				t.Fatalf("re-parse %q: %v", s, err)
			}
			if got := parsed.Filename(); got != fn {
				t.Errorf("Filename() round-trip = %q, want %q", got, fn)
			}
		}
	}
}
