package cmd_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// TestNewMux_ServesEventStream pins the SSE route to the server-mode mux.
// The desktop asset-server path deliberately excludes /api/v1/events (see
// newAPIMux + api_middleware_test.go); this guards the other side — a
// "simplification" that dropped registerEventsRoutes from NewMux would
// silently kill server-mode live updates.
func TestNewMux_ServesEventStream(t *testing.T) {
	_, mux := newTestApp(t, nil)

	// Pre-canceled context so the indefinite-duration stream handler
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

// A browser's EventSource fires onopen when the response headers arrive.
// The handler used to write nothing until the first event or the 25 s
// keepalive, so a client connecting to an idle server sat in "connecting"
// for up to 25 s and the UI read that as a lost connection.
func TestEventStream_AnswersAtOnce(t *testing.T) {
	_, mux := newTestApp(t, nil)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL+"/api/v1/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("no response within 2 s of connecting: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}
}
