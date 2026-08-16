package cmd_test

import (
	"archive/zip"
	"bytes"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"recall/pkg/bundle"
	"recall/pkg/coach"
	"recall/pkg/db/dbtest"
)

// TestExportBundle_PostReturnsZip drives the new bundle endpoint
// through httptest. The dbtest.Fake is empty, so the response body is
// a small ZIP containing just the manifest + data.json.
func TestExportBundle_PostReturnsZip(t *testing.T) {
	_, mux := newTestApp(t, dbtest.New())

	rec := fire(t, mux, http.MethodPost, "/api/v1/exports/bundle", map[string]any{
		"match_keys":      []string{},
		"include_unknown": false,
		"include_hidden":  false,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/zip" {
		t.Errorf("Content-Type = %q, want application/zip", ct)
	}
	if cd := rec.Header().Get("Content-Disposition"); !strings.Contains(cd, "recall-bundle-") {
		t.Errorf("Content-Disposition = %q, expected recall-bundle- prefix", cd)
	}

	// The body is a parseable ZIP with manifest.json + data.json.
	body := rec.Body.Bytes()
	zr, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		t.Fatalf("parse zip: %v", err)
	}
	have := map[string]bool{}
	for _, f := range zr.File {
		have[f.Name] = true
	}
	if !have["manifest.json"] {
		t.Error("manifest.json missing from bundle response")
	}
	if !have["data.json"] {
		t.Error("data.json missing from bundle response")
	}
}

// shareMatchKey is the one match the share-mode fixtures export.
const shareMatchKey = "match-2026-05-10T22-21-11"

// postShareBundle exports the fixture match in share mode and hands back
// the response, so each case asserts on one thing.
func postShareBundle(t *testing.T, share map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	store := dbtest.New()
	seedMatchKeys(store, shareMatchKey)
	_, mux := newTestApp(t, store)
	return fire(t, mux, http.MethodPost, "/api/v1/exports/bundle", map[string]any{
		"match_keys": []string{shareMatchKey},
		"share":      share,
	})
}

// A player hands their history to a coach by exporting in SHARE mode — the
// same endpoint plus who the bundle is about. Without the identity in the
// manifest the coach's session opens on a blank handle and every note is
// refused, so this is the only path that makes a session usable.
func TestExportBundle_ShareModeStampsTheIdentityIntoTheManifest(t *testing.T) {
	const spoofed = "0f8fad5b-d9cb-469f-a165-70867728950e"
	rec := postShareBundle(t, map[string]any{
		"handle": "  Sable  ", "message": "ult timing on control", "id": spoofed,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	contents, err := bundle.Read(rec.Body.Bytes())
	if err != nil {
		t.Fatalf("read the exported bundle: %v", err)
	}
	player := contents.Manifest.Player
	if player == nil {
		t.Fatal("share-mode export produced a manifest with no player")
	}
	if player.Handle != "Sable" || player.Message != "ult timing on control" {
		t.Errorf("manifest player = %+v, want the trimmed handle and the message", player)
	}
	// The id is minted and persisted server-side; a body cannot claim one.
	if !coach.IsUUID(player.ID) || player.ID == spoofed {
		t.Errorf("manifest player id = %q, want a freshly minted UUID", player.ID)
	}
}

// The bundle a share export produces is the coach's to OPEN, never to
// merge — mis-clicking Import… on it must not graft the player's history
// into the coach's own database.
func TestExportBundle_ShareModeBundleIsRefusedByImport(t *testing.T) {
	rec := postShareBundle(t, map[string]any{"handle": "Sable"})
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	coachStore := dbtest.New()
	if _, err := bundle.Import(coachStore, rec.Body.Bytes()); !errors.Is(err, bundle.ErrCoachBundle) {
		t.Fatalf("Import(share bundle) = %v, want bundle.ErrCoachBundle", err)
	}
	if coachStore.UpsertCalls != 0 {
		t.Errorf("%d rows written; a refused import must not touch the store", coachStore.UpsertCalls)
	}
}

// A share with nothing to attribute it to is a body error, not a 500.
func TestExportBundle_ShareModeNeedsAHandle(t *testing.T) {
	rec := postShareBundle(t, map[string]any{"message": "no handle here"})
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

// An explicit null is a schema violation, like every other optional field
// on this body.
func TestExportBundle_RejectsNullShare(t *testing.T) {
	_, mux := newTestApp(t, dbtest.New())
	rec := postRaw(t, mux, "/api/v1/exports/bundle", `{"match_keys":[],"share":null}`)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestExportBundle_PostRejectsMalformedJSON(t *testing.T) {
	_, mux := newTestApp(t, dbtest.New())
	rec := postRaw(t, mux, "/api/v1/exports/bundle", "{not json")
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}
