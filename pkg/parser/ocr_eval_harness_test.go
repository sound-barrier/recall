package parser_test

import (
	"errors"
	"image"
	"path/filepath"
	"testing"
	"time"

	"recall/pkg/parser"
)

// The OCR engine evaluation's harness on a stubbed seam, case by case: what
// it does with a crop an engine could not read, with a call the dump saw
// fail, with a reading outside a region's whitelist, and with a parse the
// goldens no longer describe.

// A Tesseract failure the dump recorded is replayed as a failure for every
// engine, so the retry ladder asks for the same next key the dump did; an
// engine that left no reading for a crop the dump recorded is counted as a
// read failure, apart from the calls the dump never made.
func TestOCREval_ReplaysADumpedFailureAndCountsAnUnreadCrop(t *testing.T) {
	stubOCRFailingOnce(t, "detect_history", map[string]string{"detect_history": "AQ RESETS EVERY PATCH"})
	dir, imageDir, name := dumpStubbedHistoryShot(t, `{"screenshot_type": "history", "result": {"history": true}}`)
	calls := readManifest(t, dir).Images[0].Calls
	for _, call := range calls {
		text := "a reading the retry must never see"
		if call.Error == "" {
			text = readEvalText(t, dir, baselineEngine, name, call.Key)
		}
		if call.Key != "detect_rank.0" {
			writeEvalFile(t, textPath(dir, "wmo-pre", name, call.Key), []byte(text))
		}
	}

	rep := replayCorpus(t, dir, imageDir, imageDir)

	wmo := rep.Engines[1]
	if wmo.ImagesExact != 1 || wmo.UnansweredCalls != 0 || wmo.EngineReadFailures != 1 {
		t.Errorf("wmo-pre: %d exact, %d unanswered, %d read failures; want 1, 0, 1 (the failed call replayed as one, detect_rank.0 unread)",
			wmo.ImagesExact, wmo.UnansweredCalls, wmo.EngineReadFailures)
	}
	if wmo.Regions == nil || wmo.Regions.Unread != 1 {
		t.Errorf("wmo-pre agreement = %+v, want the one crop it left unread counted", wmo.Regions)
	}
}

// The baseline replay is held to the dump's own parse, byte for byte, not to
// the goldens: a Tesseract build that reads a screenshot differently from the
// goldens is drift for the golden lane to report, not a broken harness.
func TestOCREval_HoldsTheBaselineReplayToTheDumpedParse(t *testing.T) {
	stubOCR(t, map[string]string{"detect_history": "AQ RESETS EVERY PATCH"})
	dir, imageDir, _ := dumpStubbedHistoryShot(t, `{"screenshot_type": "history", "result": {"history": false}}`)

	rep := replayCorpus(t, dir, imageDir, imageDir)
	if base := rep.Engines[0]; base.ImagesExact != 0 || base.ImagesMatchingDump != 1 {
		t.Errorf("baseline: %d golden-exact, %d matching the dump; want 0 and 1", base.ImagesExact, base.ImagesMatchingDump)
	}
	if problem := baselineReplayProblem(rep); problem != "" {
		t.Errorf("a faithful replay of a parse the goldens disagree with was refused: %s", problem)
	}

	m := readManifest(t, dir)
	m.Images[0].Snapshot = []byte(`{"screenshot_type":"unknown","result":null}`)
	writeEvalJSON(t, filepath.Join(dir, "manifest.json"), m)
	if problem := baselineReplayProblem(replayCorpus(t, dir, imageDir, imageDir)); problem == "" {
		t.Error("a replay that differs from the dumped parse was accepted as faithful")
	}
}

// The character error rate counts characters, not bytes: the roster prints
// Lúcio and Torbjörn, and an accent misread is one edit.
func TestOCREval_CERCountsCharactersNotBytes(t *testing.T) {
	var a regionAgreement
	a.add("LUCIO", "LÚCIO")
	if a.EditDistance != 1 || a.ReferenceChars != 5 {
		t.Errorf("LUCIO vs LÚCIO: distance %d over %d chars, want 1 over 5", a.EditDistance, a.ReferenceChars)
	}
	a = regionAgreement{}
	a.add("TORBJÖRN", "TORBJORN")
	if a.EditDistance != 1 || a.ReferenceChars != 8 {
		t.Errorf("TORBJÖRN vs TORBJORN: distance %d over %d chars, want 1 over 8", a.EditDistance, a.ReferenceChars)
	}
}

// An empty list or object is a field of the golden, so a replay that drops it
// or fills it is scored down.
func TestOCREval_ScoresEmptyContainersAsFields(t *testing.T) {
	golden := jsonLeaves(t, []byte(`{"result": {"heroes_played": [], "stats": {}}}`))
	replayed := jsonLeaves(t, []byte(`{"result": {}}`))
	if got := countMatching(golden, replayed); got != 0 || len(golden) != 2 {
		t.Errorf("matched %d of %d golden fields, want 0 of 2", got, len(golden))
	}
}

// dumpStubbedHistoryShot dumps one tiny screenshot through the stubbed seam,
// with golden beside it, and returns the evaluation dir, the image dir and
// the screenshot's name.
func dumpStubbedHistoryShot(t *testing.T, golden string) (dir, imageDir, name string) {
	t.Helper()
	shot := writePNG(t, tinyImage())
	imageDir, name = filepath.Dir(shot), filepath.Base(shot)
	writeEvalFile(t, filepath.Join(imageDir, name+".golden.json"), []byte(golden))
	dir = t.TempDir()
	dumpCorpus(t, dir, imageDir, []string{name}, "stub")
	return dir, imageDir, name
}

func readManifest(t *testing.T, dir string) evalManifest {
	t.Helper()
	var m evalManifest
	readEvalJSON(t, filepath.Join(dir, "manifest.json"), &m)
	return m
}

// stubOCRFailingOnce answers from table, except that the first call to the
// failing region errors, as a transient Tesseract failure would.
func stubOCRFailingOnce(t *testing.T, failing string, table map[string]string) {
	t.Helper()
	prevDelays := *parser.TesseractRetryDelays
	*parser.TesseractRetryDelays = []time.Duration{0}
	original := *parser.RunTesseractFunc
	failed := false
	*parser.RunTesseractFunc = func(_ image.Image, spec parser.OCRSpec) (string, error) {
		name := parser.SpecName(spec)
		if name == failing && !failed {
			failed = true
			return "", errors.New("tesseract failed: exit status 1")
		}
		return table[name], nil
	}
	t.Cleanup(func() {
		*parser.RunTesseractFunc = original
		*parser.TesseractRetryDelays = prevDelays
	})
}
