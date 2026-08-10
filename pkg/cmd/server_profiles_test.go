package cmd_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// Profile routes beyond the happy paths in server_test.go: the shared
// "body isn't JSON" gate on every writer, and the tour's seed endpoint.

// Each profile writer decodes its own body, so each needs its own 400 —
// a handler that skipped the decode check would pass the zero-value name
// straight into CreateProfile / SwitchProfile and answer 4xx for the
// wrong reason (or, for rename, silently target "").
func TestProfileWriters_RejectNonObjectBody(t *testing.T) {
	cases := []struct{ name, method, path string }{
		{"create", http.MethodPost, "/api/v1/profiles"},
		{"switch active", http.MethodPut, "/api/v1/profiles/active"},
		{"rename", http.MethodPut, "/api/v1/profiles/main"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			mux := newTestAppWithProfiles(t)
			rec := fireBody(t, mux, tc.method, tc.path, strings.NewReader(`["not","an","object"]`))
			assertProblem(t, rec, http.StatusBadRequest, "invalid-body", "invalid JSON body")
		})
	}
}

// POST /profiles/test/seed is the onboarding walkthrough's data source.
// Two contracts the tour depends on: seeding twice must not double the
// corpus (the user can re-enter the walkthrough), and it must NOT switch
// the active profile out from under whatever the user was looking at.
func TestSeedTestProfile_IsIdempotentAndLeavesTheActiveProfileAlone(t *testing.T) {
	mux := newTestAppWithProfiles(t)

	first := seedTestProfile(t, mux)
	if first.AlreadySeeded {
		t.Errorf("first seed reported already_seeded=true")
	}
	if first.Matches == 0 {
		t.Fatal("first seed produced no matches; the walkthrough would run on an empty corpus")
	}

	second := seedTestProfile(t, mux)
	if !second.AlreadySeeded {
		t.Errorf("second seed reported already_seeded=false; it re-seeded")
	}
	if second.Matches != first.Matches {
		t.Errorf("match count moved %d → %d across a repeat seed", first.Matches, second.Matches)
	}

	var listing struct {
		Active    string   `json:"active"`
		Immutable []string `json:"immutable"`
	}
	if err := json.Unmarshal(get(t, mux, "/api/v1/profiles").Body.Bytes(), &listing); err != nil {
		t.Fatalf("decode profiles: %v", err)
	}
	if listing.Active != "main" {
		t.Errorf("active = %q after seeding; seeding must not switch profiles", listing.Active)
	}
	if len(listing.Immutable) != 1 || listing.Immutable[0] != first.Profile {
		t.Errorf("immutable = %v, want [%s] — the sample profile is read-only", listing.Immutable, first.Profile)
	}
}

type seedResponse struct {
	Profile       string `json:"profile"`
	Matches       int    `json:"matches"`
	AlreadySeeded bool   `json:"already_seeded"`
}

func seedTestProfile(t *testing.T, mux *http.ServeMux) seedResponse {
	t.Helper()
	rec := fire(t, mux, http.MethodPost, "/api/v1/profiles/test/seed", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("seed status = %d, want 200; body=%q", rec.Code, rec.Body.String())
	}
	var got seedResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode seed response: %v (%s)", err, rec.Body.String())
	}
	return got
}
