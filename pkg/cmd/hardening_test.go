package cmd_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"recall/pkg/app"
	"recall/pkg/cmd"
	"recall/pkg/db/dbtest"
)

// hardenedMux wraps NewMux in the same middleware stack RunServer
// uses, so these tests exercise the body cap + nosniff header that
// only exist in the composed handler (the bare-mux helpers in
// server_test.go bypass it).
func hardenedMux(t *testing.T) http.Handler {
	t.Helper()
	a := app.NewWithStore(dbtest.New())
	a.SSEHub = app.NewSSEHub()
	return cmd.WithRequestID(cmd.WithSecurityHardening(cmd.NewMux(a, fstest.MapFS{})))
}

func TestHardening_SetsNosniffHeaderOnEveryResponse(t *testing.T) {
	h := hardenedMux(t)
	rec := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/matches", nil)
	h.ServeHTTP(rec, req)

	if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Errorf("X-Content-Type-Options = %q, want %q", got, "nosniff")
	}
}

func TestHardening_OversizeBodyRejected(t *testing.T) {
	h := hardenedMux(t)

	// A valid-JSON body bigger than the 8 MiB default cap. The bulk
	// queue-type endpoint takes {"match_keys":[...],"queue_type":...};
	// pad match_keys with one enormous string so the payload is a
	// single complete JSON value that sails past the cap. Without the
	// MaxBytesReader the decoder would buffer the whole thing.
	huge := strings.Repeat("a", int(cmd.DefaultMaxBodyBytes)+1<<20) // ~9 MiB
	body := `{"match_keys":["` + huge + `"],"queue_type":"role"}`

	rec := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPut, "/api/v1/matches/queue", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rec, req)

	// The body read trips MaxBytesReader, the handler's json.Decode
	// returns an error, and the handler responds 4xx. We don't assert
	// an exact code (400 vs 413 depends on the handler's decode-error
	// path) — only that the request did NOT succeed and was bounded.
	if rec.Code < 400 {
		t.Errorf("oversize body got status %d, want a 4xx rejection", rec.Code)
	}
}

func TestHardening_NormalBodyPassesThrough(t *testing.T) {
	h := hardenedMux(t)

	// A small, well-formed body must still be accepted (the cap only
	// rejects oversize payloads). Use a setter that returns 204 on a
	// valid body.
	rec := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPut, "/api/v1/settings/watcher",
		strings.NewReader(`{"enabled":false}`))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rec, req)

	if rec.Code >= 400 {
		t.Errorf("valid small body got status %d, want < 400", rec.Code)
	}
}

func TestMaxBodyForPath(t *testing.T) {
	if got := cmd.MaxBodyForPath("/api/v1/imports"); got != cmd.ImportMaxBodyBytes {
		t.Errorf("imports cap = %d, want %d", got, cmd.ImportMaxBodyBytes)
	}
	if got := cmd.MaxBodyForPath("/api/v1/matches/queue"); got != cmd.DefaultMaxBodyBytes {
		t.Errorf("default cap = %d, want %d", got, cmd.DefaultMaxBodyBytes)
	}
}

func TestIsLoopbackBind(t *testing.T) {
	cases := []struct {
		addr string
		want bool
	}{
		{":7000", false},             // all interfaces
		{"0.0.0.0:7000", false},      // all interfaces
		{"[::]:7000", false},         // all interfaces
		{"127.0.0.1:7000", true},     // loopback
		{"localhost:7000", true},     // loopback name
		{"[::1]:7000", true},         // loopback v6
		{"192.168.1.10:7000", false}, // routable LAN
		{"garbage", false},           // unparseable → exposed
	}
	for _, c := range cases {
		if got := cmd.IsLoopbackBind(c.addr); got != c.want {
			t.Errorf("cmd.IsLoopbackBind(%q) = %v, want %v", c.addr, got, c.want)
		}
	}
}

func TestPprofEnabled(t *testing.T) {
	for _, off := range []string{"", "0", "false"} {
		t.Setenv("RECALL_PPROF", off)
		if cmd.PprofEnabled() {
			t.Errorf("cmd.PprofEnabled() should be false for %q", off)
		}
	}
	for _, on := range []string{"1", "true", "yes"} {
		t.Setenv("RECALL_PPROF", on)
		if !cmd.PprofEnabled() {
			t.Errorf("cmd.PprofEnabled() should be true for %q", on)
		}
	}
}
