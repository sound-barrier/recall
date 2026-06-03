package cmd

import (
	"encoding/json"
	"net/http"
	"testing"

	"recall/pkg/db"
	"recall/pkg/db/dbtest"
)

func seedMatches(t *testing.T, fs *dbtest.Fake, keys ...string) {
	t.Helper()
	for _, k := range keys {
		if err := fs.UpsertSummary(db.SummaryRow{
			Filename: k + ".png",
			MatchKey: k,
			Map:      "rialto",
			Hero:     "lucio",
		}); err != nil {
			t.Fatalf("UpsertSummary: %v", err)
		}
	}
}

func decodeMatchKeys(t *testing.T, body []byte) []string {
	t.Helper()
	var arr []map[string]any
	if err := json.Unmarshal(body, &arr); err != nil {
		t.Fatalf("decode: %v", err)
	}
	out := make([]string, 0, len(arr))
	for _, r := range arr {
		out = append(out, r["match_key"].(string))
	}
	return out
}

func TestGetMatches_NoPagination_BackCompat(t *testing.T) {
	fs := dbtest.New()
	_, mux := newTestApp(t, fs)
	seedMatches(t, fs, "m1", "m2", "m3")

	rec := get(t, mux, "/api/v1/matches")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	keys := decodeMatchKeys(t, rec.Body.Bytes())
	if len(keys) != 3 {
		t.Errorf("got %d, want 3 (no pagination = full corpus)", len(keys))
	}
}

func TestGetMatches_LimitOnly_TakesFirstN(t *testing.T) {
	fs := dbtest.New()
	_, mux := newTestApp(t, fs)
	seedMatches(t, fs, "m1", "m2", "m3", "m4", "m5")

	rec := get(t, mux, "/api/v1/matches?limit=2")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	keys := decodeMatchKeys(t, rec.Body.Bytes())
	if len(keys) != 2 {
		t.Errorf("got %d keys, want 2", len(keys))
	}
}

func TestGetMatches_CursorPaging_PageBoundary(t *testing.T) {
	fs := dbtest.New()
	_, mux := newTestApp(t, fs)
	seedMatches(t, fs, "m1", "m2", "m3", "m4", "m5")

	// Page 1.
	rec := get(t, mux, "/api/v1/matches?limit=2")
	page1 := decodeMatchKeys(t, rec.Body.Bytes())
	last := page1[len(page1)-1]

	// Page 2 — start strictly after the last key from page 1.
	rec = get(t, mux, "/api/v1/matches?limit=2&cursor="+last)
	page2 := decodeMatchKeys(t, rec.Body.Bytes())

	if len(page2) != 2 {
		t.Fatalf("page 2 had %d keys, want 2", len(page2))
	}
	for _, k := range page2 {
		for _, p1 := range page1 {
			if k == p1 {
				t.Errorf("page 2 contained %q from page 1 — cursor must be exclusive", k)
			}
		}
	}
}

func TestGetMatches_LimitClampedTo1000(t *testing.T) {
	// Helper-level exercise — the e2e clamp would need 1001 fake
	// rows; this is the same behaviour at one level lower.
	if n, _ := parseMatchesPagination(httpReq("GET", "/api/v1/matches?limit=999999")); n != 1000 {
		t.Errorf("limit clamp = %d, want 1000", n)
	}
}

func TestGetMatches_InvalidLimit_DisablesPagination(t *testing.T) {
	if n, _ := parseMatchesPagination(httpReq("GET", "/api/v1/matches?limit=abc")); n != 0 {
		t.Errorf("invalid limit = %d, want 0 (back-compat unbounded)", n)
	}
	if n, _ := parseMatchesPagination(httpReq("GET", "/api/v1/matches?limit=0")); n != 0 {
		t.Errorf("limit=0 = %d, want 0", n)
	}
	if n, _ := parseMatchesPagination(httpReq("GET", "/api/v1/matches?limit=-5")); n != 0 {
		t.Errorf("negative limit = %d, want 0", n)
	}
}

func httpReq(method, url string) *http.Request {
	r, _ := http.NewRequest(method, url, nil)
	return r
}
