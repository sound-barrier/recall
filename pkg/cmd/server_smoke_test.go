package cmd_test

import (
	"net/http"
	"strings"
	"testing"
	"testing/fstest"

	"recall/pkg/cmd"
	"recall/pkg/db/dbtest"
)

// Server smoke test — drives a representative cross-section of
// routes through a real `*app.App` + the production `NewMux` so the
// mux wiring shape (route table, middleware order, prefix routing
// for `/_screenshot/`, SPA fallback on `/`) is covered end-to-end.
//
// `RunServer` itself stays uncovered — it owns the OS signal
// listener and the blocking `ListenAndServe` call, which can't be
// driven cleanly from a unit test. Everything inside the request-
// handling path is reachable via this smoke pass.

// smokeMux builds the same mux RunServer builds, against a fake
// store, but with a stub embedded asset FS so the SPA fallback
// resolves cleanly.
func smokeMux(t *testing.T) *http.ServeMux {
	t.Helper()
	_, mux := newTestApp(t, dbtest.New())
	return mux
}

func TestServerSmoke_GetMatches_EmptyStore_Returns200WithArray(t *testing.T) {
	mux := smokeMux(t)
	rec := get(t, mux, "/api/v1/matches")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	// Content-Type must be application/json so a JSON client can
	// auto-deserialize without sniffing the body.
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
	// Body must serialize to `[]` (not `null`) — schemathesis catches
	// the nil-slice regression elsewhere; this is the smoke check.
	if body := strings.TrimSpace(rec.Body.String()); body != "[]" {
		t.Errorf("body = %q, want %q", body, "[]")
	}
}

func TestServerSmoke_PostParses_NoScreenshotsDir_Returns409(t *testing.T) {
	mux := smokeMux(t)
	rec := fire(t, mux, http.MethodPost, "/api/v1/parses", nil)
	// 409: the fake store has no configured screenshots dir, so the
	// parse pipeline can't start. Confirmed by the
	// `app.ErrInvalidScreenshotsDir → 409` mapping in NewMux.
	if rec.Code != http.StatusConflict {
		t.Errorf("status %d, want 409: %s", rec.Code, rec.Body.String())
	}
}

func TestServerSmoke_GetVersion_Returns200(t *testing.T) {
	mux := smokeMux(t)
	rec := get(t, mux, "/api/v1/system/version")
	if rec.Code != http.StatusOK {
		t.Errorf("status %d, want 200: %s", rec.Code, rec.Body.String())
	}
}

func TestServerSmoke_GetExports_DefaultFormat_Returns200JSON(t *testing.T) {
	mux := smokeMux(t)
	rec := get(t, mux, "/api/v1/exports")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
}

func TestServerSmoke_GetExportsCSV_Returns200Zip(t *testing.T) {
	mux := smokeMux(t)
	rec := get(t, mux, "/api/v1/exports?format=csv")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/zip") {
		t.Errorf("Content-Type = %q, want application/zip", ct)
	}
}

func TestServerSmoke_DeleteMatches_Returns204(t *testing.T) {
	mux := smokeMux(t)
	rec := del(t, mux, "/api/v1/matches")
	if rec.Code != http.StatusNoContent {
		t.Errorf("status %d, want 204: %s", rec.Code, rec.Body.String())
	}
}

func TestServerSmoke_Screenshot_TRACE_Returns405WithAllow(t *testing.T) {
	mux := smokeMux(t)
	rec := fire(t, mux, http.MethodTrace, "/_screenshot/0/whatever.png", nil)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("status %d, want 405: %s", rec.Code, rec.Body.String())
	}
	if allow := rec.Header().Get("Allow"); allow != "GET, HEAD" {
		t.Errorf("Allow = %q, want %q", allow, "GET, HEAD")
	}
}

func TestServerSmoke_UnknownAPIRoute_Returns404(t *testing.T) {
	mux := smokeMux(t)
	rec := get(t, mux, "/api/v1/does-not-exist")
	// Unknown routes inside the API sub-mux return 404 via the SPA
	// fallback (the FileServer on `/`) — `NewMux` mounts the API
	// sub-mux at `/api/v1/`, and the SPA serves the embedded
	// frontend assets for everything else. Without a real asset
	// here (`fstest.MapFS{}`), the FileServer 404s.
	if rec.Code != http.StatusNotFound {
		t.Errorf("status %d, want 404: %s", rec.Code, rec.Body.String())
	}
}

func TestServerSmoke_SPAFallback_StaticAsset_Returns404OnEmptyAssetFS(t *testing.T) {
	// Build a mux with a deliberately-populated MapFS asset so the
	// SPA fallback resolves a known file. Confirms the `/` mount
	// reaches the FileServer at all.
	_, mux := newTestApp(t, dbtest.New())
	_ = mux // unused — newTestApp already wired the mux. The
	// asset-FS lookup is exercised by the regular `unknownAPIRoute`
	// test above; this test just pins that the outer mount works
	// when assets are non-empty.
	withAssets := smokeMuxWithAssets(t, fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("<!doctype html><title>Recall</title>")},
	})
	rec := get(t, withAssets, "/")
	if rec.Code != http.StatusOK {
		t.Errorf("status %d, want 200 for SPA root: %s", rec.Code, rec.Body.String())
	}
	if body := rec.Body.String(); !strings.Contains(body, "Recall") {
		t.Errorf("body does not contain SPA marker: %q", body)
	}
}

// smokeMuxWithAssets is a variant of newTestApp's mux helper that
// uses the caller's asset FS instead of fstest.MapFS{}.
func smokeMuxWithAssets(t *testing.T, assets fstest.MapFS) *http.ServeMux {
	t.Helper()
	a, _ := newTestApp(t, dbtest.New())
	return cmd.NewMux(a, assets)
}
