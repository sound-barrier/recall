package parser_test

import (
	"errors"
	"fmt"
	"image"
	"testing"
	"time"

	"recall/pkg/parser"
)

// Transient Tesseract failures (a screenshot mid-flush, an AV scan
// holding the binary) get two quick retries before a region is given
// up on; timeouts are never retried — they already burned the full
// per-call budget.

func swapRetrySeams(t *testing.T, fn func(pre image.Image, spec parser.OCRSpec) (string, error)) {
	t.Helper()
	prevFn := *parser.RunTesseractSeam
	prevDelays := *parser.TesseractRetryDelays
	*parser.RunTesseractSeam = fn
	*parser.TesseractRetryDelays = []time.Duration{time.Millisecond, time.Millisecond}
	t.Cleanup(func() {
		*parser.RunTesseractSeam = prevFn
		*parser.TesseractRetryDelays = prevDelays
	})
}

func TestRunTesseractWithRetry_RecoversTransientFailure(t *testing.T) {
	calls := 0
	swapRetrySeams(t, func(image.Image, parser.OCRSpec) (string, error) {
		calls++
		if calls < 3 {
			return "", errors.New("transient: file busy")
		}
		return "17 / 16 / 11", nil
	})
	out, err := parser.RunTesseractWithRetry(nil, parser.NewOCRSpec("", "row", "7", ""))
	if err != nil || out != "17 / 16 / 11" {
		t.Fatalf("expected third attempt to succeed, got %q err=%v", out, err)
	}
	if calls != 3 {
		t.Errorf("calls = %d, want 3 (initial + 2 retries)", calls)
	}
}

func TestRunTesseractWithRetry_GivesUpAfterRetries(t *testing.T) {
	calls := 0
	swapRetrySeams(t, func(image.Image, parser.OCRSpec) (string, error) {
		calls++
		return "", errors.New("still broken")
	})
	if _, err := parser.RunTesseractWithRetry(nil, parser.NewOCRSpec("", "row", "7", "")); err == nil {
		t.Fatal("expected the final failure to propagate")
	}
	if calls != 3 {
		t.Errorf("calls = %d, want exactly 3 attempts", calls)
	}
}

func TestRunTesseractWithRetry_NeverRetriesTimeouts(t *testing.T) {
	calls := 0
	swapRetrySeams(t, func(image.Image, parser.OCRSpec) (string, error) {
		calls++
		return "", fmt.Errorf("%w after 10s", parser.ErrTesseractTimeout)
	})
	if _, err := parser.RunTesseractWithRetry(nil, parser.NewOCRSpec("", "row", "7", "")); !errors.Is(err, parser.ErrTesseractTimeout) {
		t.Fatalf("expected the timeout to propagate, got %v", err)
	}
	if calls != 1 {
		t.Errorf("calls = %d, want 1 (timeouts must not retry)", calls)
	}
}

func TestRunTesseractWithRetry_NoRetryOnSuccess(t *testing.T) {
	calls := 0
	swapRetrySeams(t, func(image.Image, parser.OCRSpec) (string, error) {
		calls++
		return "ok", nil
	})
	if out, err := parser.RunTesseractWithRetry(nil, parser.NewOCRSpec("", "row", "7", "")); err != nil || out != "ok" {
		t.Fatalf("unexpected result %q err=%v", out, err)
	}
	if calls != 1 {
		t.Errorf("calls = %d, want 1", calls)
	}
}
