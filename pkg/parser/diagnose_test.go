package parser_test

import (
	"image"
	"image/png"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"recall/pkg/parser"
	"recall/pkg/tesseract"
)

func writePNG(t *testing.T, img image.Image) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "shot.png")
	f, err := os.Create(path) // #nosec G304 -- temp dir path
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(f, img); err != nil {
		t.Fatal(err)
	}
	_ = f.Close()
	return path
}

func probeNames(steps []parser.ProbeStep) string {
	var names []string
	for _, s := range steps {
		mark := "-"
		if s.Matched {
			mark = "+"
		}
		names = append(names, mark+s.Name)
	}
	return strings.Join(names, " ")
}

// A diagnosis records every probe the ladder asked, in order, and which one
// claimed the image — the question a failed-parse report has to answer first.
func TestDiagnose_RecordsTheProbeLadderAndTheOutcome(t *testing.T) {
	stubOCR(t, map[string]string{"detect_history": "AQ RESETS EVERY PATCH"})
	d := parser.Diagnose(writePNG(t, tinyImage()))

	if d.Error != "" {
		t.Errorf("error = %q, want none", d.Error)
	}
	if d.Type != parser.TypeHistory {
		t.Errorf("type = %q, want %q", d.Type, parser.TypeHistory)
	}
	if got, want := probeNames(d.Probes), "-rank -summary -all-heroes -personal +history"; got != want {
		t.Errorf("probes = %q, want %q", got, want)
	}
}

// When every probe declines, the TEAMS fall-through is part of the trace, and
// the error is the one THIS build produces — which tells a reader whether a
// ledgered failure is already fixed.
func TestDiagnose_ReportsTheFallThroughAndThisBuildsError(t *testing.T) {
	stubOCR(t, map[string]string{})
	d := parser.Diagnose(writePNG(t, tinyImage()))

	if !strings.Contains(d.Error, "highlighted") {
		t.Errorf("error = %q, want the teams fall-through's highlighted-row failure", d.Error)
	}
	if d.Type != parser.TypeUnknown {
		t.Errorf("type = %q, want unknown for a failed parse", d.Type)
	}
	if got, want := probeNames(d.Probes), "-rank -summary -all-heroes -personal -history +teams"; got != want {
		t.Errorf("probes = %q, want %q", got, want)
	}
}

func TestDiagnose_AnUndecodableFileSaysSo(t *testing.T) {
	path := filepath.Join(t.TempDir(), "broken.png")
	if err := os.WriteFile(path, []byte("not a png"), 0o600); err != nil {
		t.Fatal(err)
	}
	d := parser.Diagnose(path)
	if !strings.Contains(d.Error, "decoding image") {
		t.Errorf("error = %q, want the decode failure", d.Error)
	}
	if len(d.Probes) != 0 {
		t.Errorf("no probe can run on an undecodable file, got %+v", d.Probes)
	}
}

// The point of the diagnosis is the intermediates: every crop Tesseract saw
// and every string it read, keyed by region, from the diagnosis's own work
// dir — never RECALL_DEBUG_DIR, and never left on disk afterwards.
func TestDiagnose_KeepsEveryCropAndReading(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake tesseract is a shell script")
	}
	bin := t.TempDir()
	fake := filepath.Join(bin, "tesseract")
	if err := os.WriteFile(fake, []byte("#!/bin/sh\necho 'AQ RESETS EVERY PATCH'\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	tesseract.SetPath(fake)
	t.Cleanup(func() { tesseract.SetPath("tesseract") })

	d := parser.Diagnose(writePNG(t, tinyImage()))

	for _, name := range []string{"detect_rank.png", "detect_rank.txt", "detect_history.png", "detect_history.txt"} {
		if len(d.Files[name]) == 0 {
			t.Errorf("work file %s missing from the diagnosis (have %d files)", name, len(d.Files))
		}
	}
	if got := d.OCR["detect_history"]; !strings.Contains(got, "RESETS EVERY PATCH") {
		t.Errorf("OCR[detect_history] = %q, want the region's reading", got)
	}
}
