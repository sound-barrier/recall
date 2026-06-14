package app_test

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"strings"
	"testing"
	"time"

	"recall/pkg/app"
)

// realBundleBytes seeds the standard fixture, runs ExportBundle with
// the include-everything toggles, and returns the resulting ZIP
// bytes. Used as the "happy path" payload for the round-trip
// validator test plus as the base for the tampered-payload tests.
func realBundleBytes(t *testing.T) []byte {
	t.Helper()
	a, _, _ := seedBundleFixture(t)
	payload, err := a.ExportBundle(app.ExportBundleOptions{
		MatchKeys:      []string{"match-1"},
		IncludeUnknown: true,
		IncludeHidden:  true,
	})
	if err != nil {
		t.Fatalf("ExportBundle: %v", err)
	}
	return payload
}

func TestValidateBundle_RealBundleHasNoIssues(t *testing.T) {
	payload := realBundleBytes(t)
	issues, err := app.ValidateBundle(payload)
	if err != nil {
		t.Fatalf("ValidateBundle: %v", err)
	}
	if len(issues) != 0 {
		for _, iss := range issues {
			t.Logf("issue: [%s] %s", iss.Kind, iss.Message)
		}
		t.Errorf("expected zero issues on a real bundle, got %d", len(issues))
	}
}

// modifyBundle rewrites the input ZIP via the caller-supplied
// transform, returning a fresh ZIP whose entries reflect the
// changes. Used to seed each tamper test without re-running the
// full export pipeline.
func modifyBundle(t *testing.T, in []byte, fn func(name string, body []byte) (keepName string, replaceBody []byte, drop bool)) []byte {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(in), int64(len(in)))
	if err != nil {
		t.Fatalf("read in: %v", err)
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	now := time.Now().UTC()
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(rc)
		_ = rc.Close()
		if err != nil {
			t.Fatal(err)
		}
		name, replaced, drop := fn(f.Name, body)
		if drop {
			continue
		}
		if name == "" {
			name = f.Name
		}
		if replaced == nil {
			replaced = body
		}
		w, err := zw.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Deflate, Modified: now})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write(replaced); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func hasIssue(issues []app.BundleIssue, kind string) bool {
	for _, iss := range issues {
		if iss.Kind == kind {
			return true
		}
	}
	return false
}

func TestValidateBundle_MissingManifest(t *testing.T) {
	tampered := modifyBundle(t, realBundleBytes(t), func(name string, body []byte) (string, []byte, bool) {
		if name == "manifest.json" {
			return "", nil, true
		}
		return name, body, false
	})
	issues, err := app.ValidateBundle(tampered)
	if err != nil {
		t.Fatalf("ValidateBundle: %v", err)
	}
	if !hasIssue(issues, app.IssueMissingManifest) {
		t.Errorf("expected %s issue, got %v", app.IssueMissingManifest, issues)
	}
}

func TestValidateBundle_MissingData(t *testing.T) {
	tampered := modifyBundle(t, realBundleBytes(t), func(name string, body []byte) (string, []byte, bool) {
		if name == "data.json" {
			return "", nil, true
		}
		return name, body, false
	})
	issues, err := app.ValidateBundle(tampered)
	if err != nil {
		t.Fatalf("ValidateBundle: %v", err)
	}
	if !hasIssue(issues, app.IssueMissingData) {
		t.Errorf("expected %s issue, got %v", app.IssueMissingData, issues)
	}
}

func TestValidateBundle_OrphanScreenshotFile(t *testing.T) {
	// Add a stray file under screenshots/ that the manifest doesn't
	// know about. Mirror the modifyBundle helper by writing a new
	// ZIP with the extra entry appended.
	in := realBundleBytes(t)
	zr, _ := zip.NewReader(bytes.NewReader(in), int64(len(in)))
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, f := range zr.File {
		rc, _ := f.Open()
		body, _ := io.ReadAll(rc)
		_ = rc.Close()
		w, _ := zw.CreateHeader(&zip.FileHeader{Name: f.Name, Method: zip.Deflate, Modified: time.Now()})
		_, _ = w.Write(body)
	}
	// Append the orphan.
	w, _ := zw.CreateHeader(&zip.FileHeader{Name: "screenshots/orphan.png", Method: zip.Deflate, Modified: time.Now()})
	_, _ = w.Write([]byte("PNG-orphan"))
	_ = zw.Close()

	issues, err := app.ValidateBundle(buf.Bytes())
	if err != nil {
		t.Fatalf("ValidateBundle: %v", err)
	}
	if !hasIssue(issues, app.IssueOrphanScreenshotFile) {
		t.Errorf("expected %s issue, got %v", app.IssueOrphanScreenshotFile, issues)
	}
}

func TestValidateBundle_ManifestMissingScreenshotFile(t *testing.T) {
	// Remove one of the screenshot files; the manifest still names it.
	tampered := modifyBundle(t, realBundleBytes(t), func(name string, body []byte) (string, []byte, bool) {
		if strings.HasPrefix(name, "screenshots/") {
			return "", nil, true
		}
		return name, body, false
	})
	issues, err := app.ValidateBundle(tampered)
	if err != nil {
		t.Fatalf("ValidateBundle: %v", err)
	}
	if !hasIssue(issues, app.IssueManifestMissingFile) {
		t.Errorf("expected %s issue, got %v", app.IssueManifestMissingFile, issues)
	}
}

func TestValidateBundle_ScreenshotsDirsLeak(t *testing.T) {
	// Inject a screenshots_dirs field into data.json. The validator
	// must flag it as a leak.
	tampered := modifyBundle(t, realBundleBytes(t), func(name string, body []byte) (string, []byte, bool) {
		if name != "data.json" {
			return name, body, false
		}
		var doc map[string]any
		_ = json.Unmarshal(body, &doc)
		doc["screenshots_dirs"] = map[string]string{"1": "/home/me/Pictures/Recall"}
		rewritten, _ := json.MarshalIndent(doc, "", "  ")
		return name, rewritten, false
	})
	issues, err := app.ValidateBundle(tampered)
	if err != nil {
		t.Fatalf("ValidateBundle: %v", err)
	}
	if !hasIssue(issues, app.IssueScreenshotsDirsLeak) {
		t.Errorf("expected %s issue, got %v", app.IssueScreenshotsDirsLeak, issues)
	}
}

func TestValidateBundle_WrongManifestSchema(t *testing.T) {
	tampered := modifyBundle(t, realBundleBytes(t), func(name string, body []byte) (string, []byte, bool) {
		if name != "manifest.json" {
			return name, body, false
		}
		var mf app.BundleManifestV1
		_ = json.Unmarshal(body, &mf)
		mf.Schema = "recall-bundle/v9"
		rewritten, _ := json.MarshalIndent(mf, "", "  ")
		return name, rewritten, false
	})
	issues, err := app.ValidateBundle(tampered)
	if err != nil {
		t.Fatalf("ValidateBundle: %v", err)
	}
	if !hasIssue(issues, app.IssueWrongManifestSchema) {
		t.Errorf("expected %s issue, got %v", app.IssueWrongManifestSchema, issues)
	}
}

func TestValidateBundle_MalformedZIPErrors(t *testing.T) {
	_, err := app.ValidateBundle([]byte("not a zip"))
	if err == nil {
		t.Fatal("expected error on malformed input, got nil")
	}
}

func TestValidateBundle_MatchCountMismatch(t *testing.T) {
	// Edit manifest.match_count to a wrong value but leave the rest.
	tampered := modifyBundle(t, realBundleBytes(t), func(name string, body []byte) (string, []byte, bool) {
		if name != "manifest.json" {
			return name, body, false
		}
		var mf app.BundleManifestV1
		_ = json.Unmarshal(body, &mf)
		mf.MatchCount = 999
		rewritten, _ := json.MarshalIndent(mf, "", "  ")
		return name, rewritten, false
	})
	issues, err := app.ValidateBundle(tampered)
	if err != nil {
		t.Fatalf("ValidateBundle: %v", err)
	}
	if !hasIssue(issues, app.IssueMatchCountMismatch) {
		t.Errorf("expected %s issue, got %v", app.IssueMatchCountMismatch, issues)
	}
}
