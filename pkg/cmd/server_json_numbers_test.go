package cmd_test

import (
	"net/http"
	"testing"

	"recall/pkg/db"
	"recall/pkg/db/dbtest"
)

// JSON Schema — and so api/openapi.yaml, and so every client generated
// from it — calls `7.0` an integer: the type is about the VALUE, not how
// it was written. Go's encoding/json disagrees and refuses a number with
// a decimal point into an `int` field, so the server answered 400 to
// bodies its own contract advertises as valid. schemathesis 4.27 found
// both of these; a generated client that serializes a JS number, or any
// caller that hands `7.0` to json.dumps, would have found them in the
// field.
//
// The reverse case stays a 400: `7.5` is not an integer in any spelling.

func TestAutoBackupInterval_AcceptsIntegerWrittenAsFloat(t *testing.T) {
	_, mux := newTestApp(t, dbtest.New())

	rec := putRaw(t, mux, "/api/v1/settings/auto-backup", `{"interval_days": 7.0}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%q", rec.Code, rec.Body.String())
	}
}

func TestAutoBackupInterval_StillRejectsFractionalValue(t *testing.T) {
	_, mux := newTestApp(t, dbtest.New())

	rec := putRaw(t, mux, "/api/v1/settings/auto-backup", `{"interval_days": 7.5}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%q", rec.Code, rec.Body.String())
	}
}

func TestUpdateMatchData_AcceptsIntegerWrittenAsFloat(t *testing.T) {
	fs := dbtest.New()
	fs.Summaries = []db.SummaryRow{{Filename: "s.png", MatchKey: "match-A", Map: "rialto"}}
	_, mux := newTestApp(t, fs)

	// percent_played and damage are `type: integer` in the spec. Nested
	// objects count too — the generated body that failed carried its
	// float inside heroes[].
	body := `{"damage": 4200.0, "heroes": [{"hero": "ana", "percent_played": 50.0, "position": 0}]}`
	rec := putRaw(t, mux, matchADataPath, body)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204; body=%q", rec.Code, rec.Body.String())
	}
	saved, ok := fs.UserMatchData["match-A"]
	if !ok {
		t.Fatalf("UserMatchData not written for match-A")
	}
	if saved.Damage == nil || *saved.Damage != 4200 {
		t.Errorf("damage = %v, want 4200", saved.Damage)
	}
}

// A number too large for int64 is integral but unrepresentable. Rewriting it
// would invent a value, and the field can't hold it either — so it is left as
// written and the decoder rejects it, which is the honest answer.
func TestAutoBackupInterval_RejectsOutOfRangeNumber(t *testing.T) {
	_, mux := newTestApp(t, dbtest.New())

	rec := putRaw(t, mux, "/api/v1/settings/auto-backup", `{"interval_days": 1e300}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%q", rec.Code, rec.Body.String())
	}
}

func TestUpdateMatchData_StillRejectsFractionalValue(t *testing.T) {
	fs := dbtest.New()
	fs.Summaries = []db.SummaryRow{{Filename: "s.png", MatchKey: "match-A", Map: "rialto"}}
	_, mux := newTestApp(t, fs)

	rec := putRaw(t, mux, matchADataPath, `{"damage": 4200.5}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%q", rec.Code, rec.Body.String())
	}
}
