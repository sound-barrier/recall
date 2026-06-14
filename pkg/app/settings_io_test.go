package app_test

import (
	"encoding/json"
	"strings"
	"testing"

	"recall/pkg/app"
)

func TestLoadSettingsFrom_DefaultsWhenEmpty(t *testing.T) {
	got := app.LoadSettingsFrom(strings.NewReader(""))
	// Empty ScreenshotsDir is the correct first-run state: it lets
	// autoProbeOnFirstRun fire (the probe early-returns on any
	// non-empty value). Earlier revisions filled this with the
	// relative literal "screenshots" for wails-dev ergonomics, but
	// the fill broke the auto-probe AND surfaced as an unusable
	// relative path inside the shipped Recall.app.
	if got.ScreenshotsDir != "" {
		t.Errorf("empty input must yield empty ScreenshotsDir so auto-probe fires; got %q", got.ScreenshotsDir)
	}
	if got.PrometheusEnabled || got.WatchEnabled {
		t.Errorf("empty input must yield false toggles, got %+v", got)
	}
}

func TestLoadSettingsFrom_MalformedJSON(t *testing.T) {
	got := app.LoadSettingsFrom(strings.NewReader("not json at all"))
	// Malformed JSON must fall back to defaults (the empty-Settings
	// zero value), same first-run-ish state as the file-doesn't-exist
	// branch.
	if got.ScreenshotsDir != "" {
		t.Errorf("malformed input must yield empty ScreenshotsDir; got %q", got.ScreenshotsDir)
	}
}

func TestLoadSettingsFrom_EmptyScreenshotsDirRoundTrips(t *testing.T) {
	// A persisted "" stays "" on load — the fill-with-"screenshots"
	// step that previously lived here was removed because it
	// sabotaged autoProbeOnFirstRun. See `app.DefaultSettings()` doc
	// comment for the full rationale.
	got := app.LoadSettingsFrom(strings.NewReader(`{"screenshots_dir":""}`))
	if got.ScreenshotsDir != "" {
		t.Errorf(`explicit "" must round-trip as ""; got %q`, got.ScreenshotsDir)
	}
}

func TestLoadSettingsFrom_RoundTripPreservesFields(t *testing.T) {
	in := app.Settings{
		ScreenshotsDir:    "/srv/recall",
		TesseractPath:     "/usr/bin/tesseract",
		PrometheusEnabled: true,
		WatchEnabled:      true,
	}
	raw, err := app.MarshalSettings(in)
	if err != nil {
		t.Fatalf("marshalSettings: %v", err)
	}
	got := app.LoadSettingsFrom(strings.NewReader(string(raw)))
	if got != in {
		t.Errorf("round-trip mismatch:\n got=%+v\nwant=%+v", got, in)
	}
}

func TestMarshalSettings_IndentedShape(t *testing.T) {
	in := app.Settings{ScreenshotsDir: "screenshots", PrometheusEnabled: true}
	raw, err := app.MarshalSettings(in)
	if err != nil {
		t.Fatalf("marshalSettings: %v", err)
	}
	// Sanity: the output must be valid JSON the file format consumers expect.
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("output is not valid JSON: %v\n%s", err, raw)
	}
	if out["screenshots_dir"] != "screenshots" {
		t.Errorf("screenshots_dir lost: %+v", out)
	}
	if out["prometheus_enabled"] != true {
		t.Errorf("prometheus_enabled lost: %+v", out)
	}
	// MarshalIndent uses 2-space indent — the file is meant to be human-
	// editable, so the indentation matters.
	if !strings.Contains(string(raw), "\n  \"") {
		t.Errorf("expected 2-space indent, got %q", raw)
	}
}

func TestAppDataDir_RECALLDATADIROverride(t *testing.T) {
	t.Setenv("RECALL_DATA_DIR", "/tmp/recall-dev-fixture")
	if got := app.AppBaseDir(); got != "/tmp/recall-dev-fixture" {
		t.Errorf("app.AppBaseDir() with RECALL_DATA_DIR set: got %q, want %q",
			got, "/tmp/recall-dev-fixture")
	}
}

func TestAppDataDir_FallsThroughWhenOverrideUnset(t *testing.T) {
	t.Setenv("RECALL_DATA_DIR", "")
	// Don't assert the exact platform path — just that we get something
	// non-empty containing the platform-canonical name. Avoids hard-
	// coding macOS-vs-Linux paths into the assertion.
	got := app.AppBaseDir()
	if got == "" {
		t.Fatalf("app.AppBaseDir() returned empty string")
	}
	if !strings.Contains(got, "Recall") && !strings.Contains(got, "recall") {
		t.Errorf("app.AppBaseDir() = %q, expected to contain Recall/recall", got)
	}
}
