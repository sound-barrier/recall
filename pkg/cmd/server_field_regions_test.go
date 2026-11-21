package cmd_test

import (
	"encoding/json"
	"image"
	"net/http"
	"strings"
	"testing"

	"recall/pkg/db"
	"recall/pkg/db/dbtest"
	"recall/pkg/match"
	"recall/pkg/parser"
)

// GET /api/v1/matches/{match_key}/field-regions — where on the match's own
// screenshots each field was read, so the review UI can show a reading
// beside its pixels.

func fieldRegionsURL(key string) string { return "/api/v1/matches/" + key + "/field-regions" }

func TestGetFieldRegions_ServesTheStoredEvidence(t *testing.T) {
	fs := dbtest.New()
	seedConfirmableMisread(fs)
	// Filed in the configured folder, as SQLStore stores a parse that names none.
	fs.Summaries[0].ScreenshotsDirID = db.SentinelScreenshotsDirID
	file := db.FileRef{DirID: db.SentinelScreenshotsDirID, Filename: fs.Summaries[0].Filename}
	if err := fs.ReplaceFieldEvidence(file, db.ScreenshotEvidence{
		ImageSize: image.Pt(1920, 1080),
		Fields:    []parser.FieldEvidence{{Field: parser.ScalarPath("eliminations"), Rect: image.Rect(100, 600, 160, 640)}},
	}); err != nil {
		t.Fatal(err)
	}
	_, mux := newTestApp(t, fs)

	rec := get(t, mux, fieldRegionsURL(confirmKey))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body = %q", rec.Code, rec.Body.String())
	}
	var got match.FieldRegions
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	want := match.FieldRegion{
		SourceFile: file.Filename, DirID: db.SentinelScreenshotsDirID, Field: "data.eliminations",
		X: 100, Y: 600, Width: 60, Height: 40, ImageWidth: 1920, ImageHeight: 1080,
	}
	if len(got.Regions) != 1 || got.Regions[0] != want {
		t.Errorf("regions = %+v, want [%+v]", got.Regions, want)
	}
}

// A match whose screenshots stored no evidence answers an empty list, never
// null: the schema says array.
func TestGetFieldRegions_NoEvidenceIsAnEmptyArray(t *testing.T) {
	fs := dbtest.New()
	seedConfirmableMisread(fs)
	_, mux := newTestApp(t, fs)

	rec := get(t, mux, fieldRegionsURL(confirmKey))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if body := strings.TrimSpace(rec.Body.String()); body != `{"regions":[]}` {
		t.Errorf("body = %s, want {\"regions\":[]}", body)
	}
}

func TestGetFieldRegions_UnknownMatchIsAProblem404(t *testing.T) {
	fs := dbtest.New()
	seedConfirmableMisread(fs)
	_, mux := newTestApp(t, fs)

	rec := get(t, mux, fieldRegionsURL("match-2030-01-01T00-00-00"))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body = %q", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Errorf("Content-Type = %q, want application/problem+json", ct)
	}
}
