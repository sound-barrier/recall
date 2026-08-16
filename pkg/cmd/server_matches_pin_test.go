package cmd_test

import (
	"net/http"
	"net/url"
	"testing"

	"recall/pkg/db/dbtest"
)

// PUT /api/v1/matches/{match_key}/pin — the star toggle over the
// pinned_matches sidecar. Body shape is `{"pinned": <bool>}` with a
// `*bool` on the handler so absent / null is distinguishable from
// false; a plain bool would silently unpin on a malformed body.

func pinPath(matchKey string) string {
	return "/api/v1/matches/" + url.PathEscape(matchKey) + "/pin"
}

func TestMatchPin_PutTrueThenFalseRoundTrips(t *testing.T) {
	fs := dbtest.New()
	seedMatchKeys(fs, "match-A")
	_, mux := newTestApp(t, fs)

	if rec := put(t, mux, pinPath("match-A"), map[string]any{"pinned": true}); rec.Code != http.StatusNoContent {
		t.Fatalf("pin status = %d, want 204; body=%q", rec.Code, rec.Body.String())
	}
	pinned, err := fs.LoadPinnedKeys()
	if err != nil {
		t.Fatalf("LoadPinnedKeys: %v", err)
	}
	if !pinned["match-A"] {
		t.Fatalf("match-A not pinned in the store: %v", pinned)
	}

	if rec := put(t, mux, pinPath("match-A"), map[string]any{"pinned": false}); rec.Code != http.StatusNoContent {
		t.Fatalf("unpin status = %d, want 204; body=%q", rec.Code, rec.Body.String())
	}
	pinned, err = fs.LoadPinnedKeys()
	if err != nil {
		t.Fatalf("LoadPinnedKeys: %v", err)
	}
	if pinned["match-A"] {
		t.Errorf("match-A still pinned after {\"pinned\":false}: %v", pinned)
	}
}

// Pinning is idempotent — the Matches list re-fires the PUT whenever the
// star is toggled from a stale render, and a second identical call must
// stay a 204 rather than conflicting.
func TestMatchPin_RepeatedPinStaysNoContent(t *testing.T) {
	fs := dbtest.New()
	seedMatchKeys(fs, "match-B")
	_, mux := newTestApp(t, fs)
	for i := range 2 {
		if rec := put(t, mux, pinPath("match-B"), map[string]any{"pinned": true}); rec.Code != http.StatusNoContent {
			t.Fatalf("pin #%d status = %d, want 204; body=%q", i+1, rec.Code, rec.Body.String())
		}
	}
	pinned, _ := fs.LoadPinnedKeys()
	if len(pinned) != 1 || !pinned["match-B"] {
		t.Errorf("pinned set = %v, want exactly {match-B}", pinned)
	}
}

// A body the spec doesn't allow must be a problem+json 400 AND must not
// reach the store — a `bool` (rather than `*bool`) field would decode
// `{}` / `{"pinned":null}` to false and silently unpin the match.
func TestMatchPin_RejectsMalformedBody(t *testing.T) {
	cases := []struct {
		name, body, wantDetail, wantField string
	}{
		{"missing pinned", `{}`, "pinned", "pinned"},
		{"null pinned", `{"pinned":null}`, "pinned", "pinned"},
		{"body is not an object", `"nope"`, "invalid JSON body", ""},
		{"truncated JSON", `{"pinned":`, "invalid JSON body", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fs := dbtest.New()
			_ = fs.PinMatch("match-A")
			_, mux := newTestApp(t, fs)
			rec := putRaw(t, mux, pinPath("match-A"), tc.body)
			p := assertProblem(t, rec, http.StatusBadRequest, "invalid-body", tc.wantDetail)
			assertFieldError(t, p, tc.wantField)
			pinned, _ := fs.LoadPinnedKeys()
			if !pinned["match-A"] {
				t.Errorf("a rejected body must leave the pin untouched; pinned=%v", pinned)
			}
		})
	}
}

// assertFieldError checks the RFC 9457 §3.2 `errors` extension names
// exactly the offending field. A want of "" skips the check.
func assertFieldError(t *testing.T, p problemBody, want string) {
	t.Helper()
	if want == "" {
		return
	}
	if len(p.Errors) != 1 || p.Errors[0].Field != want {
		t.Errorf("errors = %+v, want one entry for field %q", p.Errors, want)
	}
}
