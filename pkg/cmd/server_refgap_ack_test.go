package cmd_test

import (
	"net/http"
	"testing"

	"recall/pkg/db/dbtest"
)

// PUT/DELETE /api/v1/matches/{match_key}/reference-gap-acknowledgement —
// the acknowledge-only dismiss on the Unknown tab's gap cards. PUT
// requires the match to exist (an acknowledgement nothing backs would
// strand forever); DELETE is idempotent like every sidecar removal.

func TestPutReferenceGapAck_AddsAndReturns204(t *testing.T) {
	fs := dbtest.New()
	seedMatchKeys(fs, "match-2026-05-10T22-21-11")
	_, mux := newTestApp(t, fs)

	rec := put(t, mux, "/api/v1/matches/match-2026-05-10T22-21-11/reference-gap-acknowledgement", nil)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204; body = %q", rec.Code, rec.Body.String())
	}
	if !fs.AckedReferenceGaps["match-2026-05-10T22-21-11"] {
		t.Errorf("acknowledgement not stored; got=%v", fs.AckedReferenceGaps)
	}
}

func TestPutReferenceGapAck_UnknownKeyIs404(t *testing.T) {
	_, mux := newTestApp(t, dbtest.New())
	rec := put(t, mux, "/api/v1/matches/match-2026-01-01T00-00-00/reference-gap-acknowledgement", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestDeleteReferenceGapAck_RemovesAndIsIdempotent(t *testing.T) {
	fs := dbtest.New()
	seedMatchKeys(fs, "match-2026-05-10T22-21-11")
	if err := fs.AcknowledgeReferenceGap("match-2026-05-10T22-21-11"); err != nil {
		t.Fatal(err)
	}
	_, mux := newTestApp(t, fs)

	rec := del(t, mux, "/api/v1/matches/match-2026-05-10T22-21-11/reference-gap-acknowledgement")
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	if len(fs.AckedReferenceGaps) != 0 {
		t.Errorf("acknowledgement survived DELETE: %v", fs.AckedReferenceGaps)
	}
	if rec := del(t, mux, "/api/v1/matches/match-2026-05-10T22-21-11/reference-gap-acknowledgement"); rec.Code != http.StatusNoContent {
		t.Errorf("second DELETE: status = %d, want 204 (idempotent)", rec.Code)
	}
}
