package cmd_test

import (
	"net/http"
	"testing"

	"recall/pkg/db/dbtest"
)

// The unknown-key guard over HTTP (design rule 2). Every per-match write
// that CREATES a sidecar row refuses a key this database has never seen —
// otherwise a client holding somebody else's keys (a coach reviewing a
// loaned corpus, a player accepting a note about a match they deleted)
// silently inserts an orphan row nothing will ever read back.
//
// The status is 404, not 409: the resource named in the URL does not
// exist. The clear/unset verbs stay idempotent 204s and are pinned
// separately below — the UI's fire-and-forget undo paths depend on it.

func TestPerMatchWrites_UnknownKeyIs404(t *testing.T) {
	cases := []struct {
		name, method, path string
		body               any
	}{
		{"pin", http.MethodPut, pinPath("match-ghost"), map[string]any{"pinned": true}},
		{"visibility", http.MethodPut, visibilityPath("match-ghost"), map[string]any{"hidden": true}},
		{"annotation", http.MethodPut, annotationPath("match-ghost"), map[string]any{"note": "ally dc'd"}},
		{"moment", http.MethodPut, "/api/v1/matches/match-ghost/moments/mo-1", map[string]any{"match_clock": "04:45", "text": "off-angle"}},
		{"review", http.MethodPut, reviewPath("match-ghost"), map[string]any{"reviewed_by": "self"}},
		{"queue", http.MethodPut, queuePath("match-ghost"), map[string]any{"queue_type": "role"}},
		{"play mode", http.MethodPut, playModePath("match-ghost"), map[string]any{"play_mode": "competitive"}},
		{"data edit", http.MethodPut, "/api/v1/matches/match-ghost/data", map[string]any{"map": "busan"}},
		{"bulk queue", http.MethodPut, "/api/v1/matches/queue", map[string]any{
			"match_keys": []string{"match-ghost"}, "queue_type": "role",
		}},
		{"bulk play mode", http.MethodPut, "/api/v1/matches/play-mode", map[string]any{
			"match_keys": []string{"match-ghost"}, "play_mode": "competitive",
		}},
		// A self-review sitting is a set of keys; one unknown refuses the whole
		// create, and the same for a set-matches on an existing sitting.
		{"self review create", http.MethodPost, "/api/v1/self-reviews", map[string]any{
			"match_keys": []string{"match-ghost"},
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fs := dbtest.New()
			_, mux := newTestApp(t, fs)
			rec := fire(t, mux, tc.method, tc.path, tc.body)
			if rec.Code != http.StatusNotFound {
				t.Fatalf("status = %d, want 404; body=%q", rec.Code, rec.Body.String())
			}
			if ct := rec.Header().Get("Content-Type"); ct != "application/problem+json" {
				t.Errorf("content-type = %q, want application/problem+json", ct)
			}
		})
	}
}

// A bulk write is refused WHOLE — one unknown key in the batch leaves the
// known ones untagged, so a half-applied selection can never happen.
func TestBulkSetMatchQueue_OneUnknownKeyRefusesTheBatch(t *testing.T) {
	fs := dbtest.New()
	seedMatchKeys(fs, "match-real")
	_, mux := newTestApp(t, fs)

	rec := put(t, mux, "/api/v1/matches/queue", map[string]any{
		"match_keys": []string{"match-real", "match-ghost"}, "queue_type": "role",
	})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%q", rec.Code, rec.Body.String())
	}
	queues, err := fs.LoadMatchQueues()
	if err != nil {
		t.Fatalf("LoadMatchQueues: %v", err)
	}
	if len(queues) != 0 {
		t.Errorf("batch was partially applied: %+v", queues)
	}
}

// The clear / unset verbs remove nothing on an unknown key, so they stay
// idempotent 204s rather than joining the 404 ladder.
func TestPerMatchClears_UnknownKeyStays204(t *testing.T) {
	cases := []struct{ name, path string }{
		{"annotation", annotationPath("match-ghost")},
		{"review", reviewPath("match-ghost")},
		{"queue", queuePath("match-ghost")},
		{"play mode", playModePath("match-ghost")},
		{"data edit", "/api/v1/matches/match-ghost/data"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, mux := newTestApp(t, dbtest.New())
			if rec := del(t, mux, tc.path); rec.Code != http.StatusNoContent {
				t.Fatalf("status = %d, want 204; body=%q", rec.Code, rec.Body.String())
			}
		})
	}
}
