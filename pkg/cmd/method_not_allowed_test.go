package cmd_test

import (
	"net/http"
	"testing"

	"recall/pkg/db/dbtest"
)

// TestUnsupportedMethod_OnLiteralPaths pins the explicit 405 stubs
// for `/matches/transfers` and `/profiles/active`. Without these
// stubs, the wildcard handlers (`{match_key}`, `{name}`) catch
// wrong-verb requests and operate on a row literally named
// "transfers" / "active" — the schemathesis `unsupported_method`
// check flagged this. Same path → wrong verb → 405 must hold so
// that future surface changes can't silently fall through to a
// wildcard handler.
func TestUnsupportedMethod_OnLiteralPaths(t *testing.T) {
	_, mux := newTestApp(t, dbtest.New())

	type tc struct {
		method, path string
	}
	cases := []tc{
		// /matches/transfers — POST is the live verb.
		{http.MethodGet, "/api/v1/matches/transfers"},
		{http.MethodPut, "/api/v1/matches/transfers"},
		{http.MethodDelete, "/api/v1/matches/transfers"},
		// /profiles/active — PUT is the live verb.
		{http.MethodGet, "/api/v1/profiles/active"},
		{http.MethodPost, "/api/v1/profiles/active"},
		{http.MethodDelete, "/api/v1/profiles/active"},
	}

	for _, c := range cases {
		t.Run(c.method+" "+c.path, func(t *testing.T) {
			rec := fire(t, mux, c.method, c.path, nil)
			if rec.Code != http.StatusMethodNotAllowed {
				t.Errorf("got %d, want 405 (method not allowed)", rec.Code)
			}
		})
	}
}

// TestSupportedMethods_StillRouteOnLiteralPaths is the
// belt-and-suspenders pair: confirm that registering the 405 stubs
// did NOT accidentally suppress the live handlers on the same path.
func TestSupportedMethods_StillRouteOnLiteralPaths(t *testing.T) {
	_, mux := newTestApp(t, dbtest.New())

	// POST /api/v1/matches/transfers expects a JSON body; an empty
	// one returns 400. The point here is that the request reaches
	// the live handler, not the 405 stub.
	rec := fire(t, mux, http.MethodPost, "/api/v1/matches/transfers", map[string]any{})
	if rec.Code == http.StatusMethodNotAllowed {
		t.Errorf("POST /matches/transfers got 405 — live handler shadowed by stub")
	}

	// PUT /api/v1/profiles/active expects {"name": "..."}; missing
	// name routes to the live SwitchProfile handler which returns
	// 4xx. As long as the response is NOT 405, the live route is
	// reachable.
	rec = fire(t, mux, http.MethodPut, "/api/v1/profiles/active", map[string]any{})
	if rec.Code == http.StatusMethodNotAllowed {
		t.Errorf("PUT /profiles/active got 405 — live handler shadowed by stub")
	}
}

// The `Allow` header on a 405 must name what the resource actually
// supports. Registering one 405 stub per wrong verb made Go's ServeMux
// treat those verbs as REGISTERED, so its own automatic 405 (for any
// verb with no stub — OPTIONS is the one schemathesis sends) answered
// with `Allow: DELETE, GET, POST, PUT`: three methods the resource
// refuses, advertised to every client that asks what it can do.
func TestUnsupportedMethod_AllowNamesOnlyTheLiveVerb(t *testing.T) {
	_, mux := newTestApp(t, dbtest.New())

	cases := []struct {
		path, wantAllow string
	}{
		{"/api/v1/matches/play-mode", http.MethodPut},
		{"/api/v1/matches/queue", http.MethodPut},
		{"/api/v1/matches/transfers", http.MethodPost},
		{"/api/v1/profiles/active", http.MethodPut},
	}

	for _, c := range cases {
		t.Run(c.path, func(t *testing.T) {
			rec := fire(t, mux, http.MethodOptions, c.path, nil)
			if rec.Code != http.StatusMethodNotAllowed {
				t.Fatalf("got %d, want 405", rec.Code)
			}
			if got := rec.Header().Get("Allow"); got != c.wantAllow {
				t.Errorf("Allow = %q, want %q", got, c.wantAllow)
			}
		})
	}
}
