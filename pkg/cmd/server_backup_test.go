package cmd_test

import (
	"net/http"
	"testing"
)

// Imports endpoint splits payload-level vs semantic-validation failures
// into 400 vs 409 (PR #1 of the 1.0 release plan). The split is enforced
// at the app-layer's ErrImportMalformed sentinel; the handler does an
// errors.Is dispatch.

func TestServerMux_Import_MalformedJSON_Returns400(t *testing.T) {
	_, mux := newTestApp(t, nil)
	// Neither a `{`-led JSON document nor a PK-led ZIP. The app layer's
	// looksLikeJSON / looksLikeZIP probes both fail, returning
	// ErrImportMalformed → handler maps to 400.
	rec := postRaw(t, mux, "/api/v1/imports", "garbage payload")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%q", rec.Code, rec.Body.String())
	}
}

func TestServerMux_Import_MalformedJSONDecode_Returns400(t *testing.T) {
	_, mux := newTestApp(t, nil)
	// JSON-looking (starts with `{`) but truncated mid-document.
	// Schema-peek decode fails → ErrImportMalformed → 400.
	rec := postRaw(t, mux, "/api/v1/imports", `{"schema": "recall-export/v1`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%q", rec.Code, rec.Body.String())
	}
}

func TestServerMux_Import_UnsupportedSchema_Returns409(t *testing.T) {
	_, mux := newTestApp(t, nil)
	// Valid JSON, valid envelope shape, but a schema string this build
	// doesn't recognise. App layer rejects without the malformed
	// sentinel → handler falls through to 409.
	rec := postRaw(t, mux, "/api/v1/imports", `{"schema":"recall-export/v9999"}`)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body=%q", rec.Code, rec.Body.String())
	}
}
