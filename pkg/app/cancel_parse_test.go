package app

import (
	"errors"
	"sync"
	"testing"
)

func TestCancelParse_NoFlight_ReturnsErrNoParseInFlight(t *testing.T) {
	a := &App{}
	if err := a.CancelParse(); !errors.Is(err, ErrNoParseInFlight) {
		t.Errorf("CancelParse with no parse in flight = %v, want ErrNoParseInFlight", err)
	}
}

// Simulate the parseCancel slot being held mid-parse (the field set in
// ParseScreenshots before the OCR loop) and verify CancelParse fires
// the stored func + clears the slot on a subsequent call. Wires the
// stored func directly so we don't need a live parser.
func TestCancelParse_FiresStoredCancel_AndIsRepeatedlyDrainable(t *testing.T) {
	var fired sync.Mutex
	fired.Lock()
	a := &App{}
	a.parseCancelMu.Lock()
	a.parseCancel = fired.Unlock // releasing fired signals cancel ran
	a.parseCancelMu.Unlock()

	if err := a.CancelParse(); err != nil {
		t.Fatalf("CancelParse = %v, want nil", err)
	}
	// fired's Unlock ran, so Lock() returns immediately.
	fired.Lock()
	// Pretend the OCR loop's deferred cleanup ran: parseCancel slot
	// goes back to nil. A second CancelParse must reflect that.
	a.parseCancelMu.Lock()
	a.parseCancel = nil
	a.parseCancelMu.Unlock()
	if err := a.CancelParse(); !errors.Is(err, ErrNoParseInFlight) {
		t.Errorf("CancelParse after slot cleared = %v, want ErrNoParseInFlight", err)
	}
}
