package cmd_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"recall/pkg/db/dbtest"
)

// The attachment endpoints, deterministically — this is the coverage the
// schemathesis exclusion is paid for with. The fuzzer cannot synthesize a PNG,
// so every body it generates is correctly refused as an unservable type; these
// walk a real image in and back out again.

// A single valid one-pixel PNG.
var onePixelPNG = []byte{
	0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a,
	0x00, 0x00, 0x00, 0x0d, 'I', 'H', 'D', 'R',
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
	0x00, 0x00, 0x00, 0x0a, 'I', 'D', 'A', 'T',
	0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01,
	0x0d, 0x0a, 0x2d, 0xb4,
	0x00, 0x00, 0x00, 0x00, 'I', 'E', 'N', 'D', 0xae, 0x42, 0x60, 0x82,
}

func postImage(t *testing.T, mux *http.ServeMux, body []byte, mime string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/moment-images", bytes.NewReader(body))
	req.Header.Set("Content-Type", mime)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func storedDigest(t *testing.T, mux *http.ServeMux) string {
	t.Helper()
	rec := postImage(t, mux, onePixelPNG, "image/png")
	if rec.Code != http.StatusOK {
		t.Fatalf("upload status = %d, want 200; body=%q", rec.Code, rec.Body.String())
	}
	var out struct {
		SHA256   string `json:"sha256"`
		ByteSize int    `json:"byte_size"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode receipt: %v", err)
	}
	if len(out.SHA256) != 64 {
		t.Fatalf("digest %q is not a sha256", out.SHA256)
	}
	if out.ByteSize != len(onePixelPNG) {
		t.Fatalf("byte_size = %d, want %d", out.ByteSize, len(onePixelPNG))
	}
	return out.SHA256
}

func TestMomentImages_UploadAnswersWithADigest(t *testing.T) {
	_, mux := newTestApp(t, nil)
	storedDigest(t, mux)
}

func TestMomentImages_SameBytesAnswerWithTheSameDigest(t *testing.T) {
	// Content-addressed: pinning one screenshot to three moments must not
	// store it three times, and the caller must be able to rely on that.
	_, mux := newTestApp(t, nil)
	if first, second := storedDigest(t, mux), storedDigest(t, mux); first != second {
		t.Fatalf("same bytes, two digests: %q vs %q", first, second)
	}
}

func TestMomentImages_RefusesATypeItCannotServeBack(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := postImage(t, mux, onePixelPNG, "application/zip")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%q", rec.Code, rec.Body.String())
	}
}

func TestMomentImages_RefusesNothing(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := postImage(t, mux, nil, "image/png")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%q", rec.Code, rec.Body.String())
	}
}

func TestMomentImages_ServedBackByDigest(t *testing.T) {
	fake := dbtest.New()
	a, mux := newTestApp(t, fake)
	sha := storedDigest(t, mux)

	// Serving is mounted outside the API mux, so drive the handler directly —
	// the same handler server.go and the Wails middleware both install.
	served := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/_moment-image/"+sha, nil)
	a.MomentImageHandler()(served, req)

	if served.Code != http.StatusOK {
		t.Fatalf("serve status = %d, want 200", served.Code)
	}
	if !bytes.Equal(served.Body.Bytes(), onePixelPNG) {
		t.Fatalf("served %d bytes, stored %d", served.Body.Len(), len(onePixelPNG))
	}
	if got := served.Header().Get("Content-Type"); got != "image/png" {
		t.Fatalf("Content-Type = %q, want image/png", got)
	}
	if got := served.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q, want nosniff", got)
	}
	_ = mux
}

func TestMomentImages_AMalformedDigestIsJustNotFound(t *testing.T) {
	// A digest is generated, never typed. Anything that is not one is a probe,
	// and there is nothing to look up.
	a, _ := newTestApp(t, nil)
	for _, path := range []string{
		"/_moment-image/../../etc/passwd",
		"/_moment-image/notahexdigest",
		"/_moment-image/",
	} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
		a.MomentImageHandler()(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("%s: status = %d, want 404", path, rec.Code)
		}
	}
}

func TestMomentImages_AnUnstoredDigestIsNotFound(t *testing.T) {
	// A moment can outlive its picture. That renders as a missing image.
	a, _ := newTestApp(t, nil)
	rec := httptest.NewRecorder()
	absent := "0000000000000000000000000000000000000000000000000000000000000000"
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/_moment-image/"+absent, nil)
	a.MomentImageHandler()(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestMomentImages_RefusesWritesToTheServingPath(t *testing.T) {
	a, _ := newTestApp(t, nil)
	rec := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodDelete, "/_moment-image/abc", nil)
	a.MomentImageHandler()(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", rec.Code)
	}
	if got := rec.Header().Get("Allow"); got != "GET, HEAD" {
		t.Fatalf("Allow = %q, want \"GET, HEAD\"", got)
	}
}

func TestMomentImages_HeadCarriesTheHeadersWithoutTheBody(t *testing.T) {
	fake := dbtest.New()
	a, mux := newTestApp(t, fake)
	sha := storedDigest(t, mux)

	rec := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodHead, "/_moment-image/"+sha, nil)
	a.MomentImageHandler()(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if rec.Body.Len() != 0 {
		t.Fatalf("HEAD returned %d bytes of body", rec.Body.Len())
	}
	if got := rec.Header().Get("Content-Type"); got != "image/png" {
		t.Fatalf("Content-Type = %q, want image/png", got)
	}
}
