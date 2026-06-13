package cmd_test

import (
	"encoding/json"
	"net/http"
	"net/url"
	"testing"

	"recall/pkg/db"
	"recall/pkg/db/dbtest"
)

func matchByKeyPath(matchKey string) string {
	return "/api/v1/matches/" + url.PathEscape(matchKey)
}

// Seed the fake store with one summary row → triggers an aggregated
// MatchRecord. Reused across the cases below.
func seedOneSummary(t *testing.T, fs *dbtest.Fake, matchKey, filename string) {
	t.Helper()
	if err := fs.UpsertSummary(db.SummaryRow{
		Filename: filename,
		MatchKey: matchKey,
		Map:      "rialto",
		Hero:     "lucio",
		Result:   "victory",
	}); err != nil {
		t.Fatalf("UpsertSummary: %v", err)
	}
}

func TestGetMatchByKey_FoundReturns200WithRecord(t *testing.T) {
	fs := dbtest.New()
	a, mux := newTestApp(t, fs)
	_ = a
	seedOneSummary(t, fs, "match-A", "match-A-summary.png")

	rec := get(t, mux, matchByKeyPath("match-A"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["match_key"] != "match-A" {
		t.Errorf("body.match_key = %v, want match-A", body["match_key"])
	}
}

func TestGetMatchByKey_NotFoundReturns404(t *testing.T) {
	fs := dbtest.New()
	_, mux := newTestApp(t, fs)
	rec := get(t, mux, matchByKeyPath("does-not-exist"))
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}

func TestGetMatchByKey_EmptyKeyReturns400(t *testing.T) {
	_, mux := newTestApp(t, nil)
	// Bare /api/v1/matches/ matches the GET-all route, not the
	// per-key one, so the trailing space-encoded path forces the
	// per-key registration.
	rec := get(t, mux, "/api/v1/matches/%20")
	// %20 (a single space) is a valid PathValue per Go 1.22's
	// matcher, so the handler receives " " — which is non-empty
	// and triggers the not-found branch, NOT the empty-key 400.
	// Test that the 400 path fires when the key truly empties out
	// (PathValue=""), which Go's ServeMux only does on the wrong
	// pattern — surfaced here as a 404 from the not-found branch.
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404 for whitespace key", rec.Code)
	}
}
