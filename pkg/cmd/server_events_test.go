package cmd_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestNewMux_ServesEventStream pins the SSE route to the server-mode mux.
// The desktop asset-server path deliberately excludes /api/v1/events (see
// newAPIMux + api_middleware_test.go); this guards the other side — a
// "simplification" that dropped registerEventsRoutes from NewMux would
// silently kill server-mode live updates.
func TestNewMux_ServesEventStream(t *testing.T) {
	_, mux := newTestApp(t, nil)

	// Pre-cancelled context so the indefinite-duration stream handler
	// returns immediately after writing its headers.
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	req := httptest.NewRequestWithContext(ctx, http.MethodGet, "/api/v1/events", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if got := rec.Header().Get("Content-Type"); got != "text/event-stream" {
		t.Fatalf("Content-Type = %q, want text/event-stream (SSE must stay mounted in server mode)", got)
	}
}
