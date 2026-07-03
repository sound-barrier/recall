package gamedata_test

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"recall/pkg/gamedata"
)

func TestUpdateAllowedHost(t *testing.T) {
	cases := []struct {
		host string
		want bool
	}{
		{"api.github.com", true},
		{"github.com", true},
		{"sound-barrier.github.io", true},
		{"objects.githubusercontent.com", true}, // release downloads 302 here
		{"raw.githubusercontent.com", true},
		{"evil.example.com", false},
		{"github.com.evil.example.com", false}, // suffix-confusion attempt
		{"githubusercontent.com", false},       // bare apex, not a *. subdomain
		{"localhost", false},
		{"169.254.169.254", false}, // cloud metadata endpoint
		{"", false},
	}
	for _, c := range cases {
		if got := gamedata.UpdateAllowedHost(c.host); got != c.want {
			t.Errorf("gamedata.UpdateAllowedHost(%q) = %v, want %v", c.host, got, c.want)
		}
	}
}

func TestNewUpdateClient_RedirectGuard(t *testing.T) {
	c := gamedata.NewUpdateClient()
	if c.CheckRedirect == nil {
		t.Fatal("newUpdateClient must set CheckRedirect")
	}
	mkReq := func(raw string) *http.Request {
		u, err := url.Parse(raw)
		if err != nil {
			t.Fatalf("parse %q: %v", raw, err)
		}
		return &http.Request{URL: u}
	}

	// Allowed redirect targets → follow (nil error).
	for _, ok := range []string{
		"https://github.com/sound-barrier/recall/releases/download/v1/x",
		"https://objects.githubusercontent.com/abc",
		"https://api.github.com/x",
		"https://sound-barrier.github.io/recall/data/heroes.yaml",
	} {
		if err := c.CheckRedirect(mkReq(ok), nil); err != nil {
			t.Errorf("expected %s to be followed, got error: %v", ok, err)
		}
	}

	// Off-allowlist host → refuse.
	if err := c.CheckRedirect(mkReq("https://evil.example.com/x"), nil); err == nil {
		t.Error("expected off-allowlist host redirect to be refused")
	}
	// Non-HTTPS downgrade → refuse.
	if err := c.CheckRedirect(mkReq("http://github.com/x"), nil); err == nil {
		t.Error("expected non-HTTPS redirect to be refused")
	}
	// Redirect-loop cap → refuse after 10 hops.
	via := make([]*http.Request, 10)
	if err := c.CheckRedirect(mkReq("https://github.com/x"), via); err == nil {
		t.Error("expected the 11th redirect to be refused")
	}
}

// CheckForUpdate is the one App method that makes an outbound network
// call (GitHub Releases). Tests must never touch the real API — they'd
// be slow, fragile, and would exhaust anonymous rate limits in a
// loop. Instead, each test stands up an httptest.NewServer with a
func TestVerifySha256_RejectsMalformedSidecar(t *testing.T) {
	payload := []byte("hello")
	cases := []struct {
		name    string
		sidecar []byte
		want    bool
	}{
		{"empty sidecar", []byte(""), false},
		{"truncated hash (only 10 chars)", []byte("abcdef0123  file.yaml"), false},
		{"correct hash + filename", []byte(sha256hex(payload) + "  file.yaml"), true},
		{
			"upper-case hash (sidecars sometimes ship hex like this)",
			[]byte(strings.ToUpper(sha256hex(payload)) + "  file.yaml"), true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := gamedata.VerifySha256(payload, tc.sidecar); got != tc.want {
				t.Errorf("got %v, want %v", got, tc.want)
			}
		})
	}
}

func TestParseRosterNames_DedupsAcrossGroups(t *testing.T) {
	// If a hero appears under two role-groups (the YAML schema
	// doesn't forbid it), parseRosterNames must dedup so the FE
	// doesn't render the same CTA twice.
	yaml := []byte("tank:\n  - Doomfist\n  - Reinhardt\ndps:\n  - Doomfist\n")
	names := gamedata.ParseRosterNames(yaml)
	if len(names) != 2 {
		t.Errorf("want 2 unique names (Doomfist dedup), got %v", names)
	}
}

func TestParseRosterNames_DropsBlankEntries(t *testing.T) {
	// A blank string in the YAML is filtered — the parser's
	// reference data never carries one but defending against it
	// keeps the FE from rendering a CTA with an empty backtick'd
	// label.
	yaml := []byte("tank:\n  - \"\"\n  - Reinhardt\n")
	names := gamedata.ParseRosterNames(yaml)
	if len(names) != 1 || names[0] != "Reinhardt" {
		t.Errorf("want [Reinhardt], got %v", names)
	}
}

// sha256hex computes a hex-encoded SHA-256 of the input — convenience
// for building valid sidecar bodies in tests.
func sha256hex(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}
