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
