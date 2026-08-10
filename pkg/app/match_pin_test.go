package app_test

import (
	"testing"

	"recall/pkg/app"
	"recall/pkg/db"
	"recall/pkg/db/dbtest"
)

const pinnedKey = "match-2026-03-02T19-15-00"

func pinApp(t *testing.T) (*app.App, *dbtest.Fake) {
	t.Helper()
	fake := dbtest.New()
	fake.Summaries = []db.SummaryRow{{Filename: "s.png", MatchKey: pinnedKey, Map: "rialto", Hero: "lucio"}}
	return app.NewWithStore(fake), fake
}

// The star has to survive the full write → aggregate → read round-trip: the
// list renders pinned matches in a leading section off match.Record.Pinned, so
// a pin that reaches the store but not the aggregated record is invisible.
func TestPinMatch_SurfacesOnTheAggregatedRecord(t *testing.T) {
	a, _ := pinApp(t)

	mustNoErr(t, a.PinMatch(pinnedKey))
	rec, err := a.GetMatchByKey(pinnedKey)
	mustNoErr(t, err)
	if !rec.Pinned {
		t.Fatal("Pinned = false after PinMatch")
	}

	// Idempotent: pinning twice is a no-op, not an error or a second row.
	mustNoErr(t, a.PinMatch(pinnedKey))

	mustNoErr(t, a.UnpinMatch(pinnedKey))
	rec, err = a.GetMatchByKey(pinnedKey)
	mustNoErr(t, err)
	if rec.Pinned {
		t.Error("Pinned = true after UnpinMatch")
	}
	// Unpinning an already-unpinned match is a no-op too — the UI can
	// double-fire the toggle.
	mustNoErr(t, a.UnpinMatch(pinnedKey))
}

// An empty match_key is a routing bug, not a request to pin "everything" — the
// HTTP layer maps the error to 400 rather than letting a keyless row land in
// pinned_matches.
func TestPinMatch_RejectsEmptyKeyWithoutTouchingTheStore(t *testing.T) {
	a, fake := pinApp(t)
	calls := []struct {
		name string
		call func(string) error
	}{
		{"PinMatch", a.PinMatch},
		{"UnpinMatch", a.UnpinMatch},
	}
	for _, c := range calls {
		t.Run(c.name, func(t *testing.T) {
			err := c.call("")
			if err == nil {
				t.Fatalf("%s(\"\") succeeded, want an error", c.name)
			}
			if err.Error() != "match_key required" {
				t.Errorf("%s(\"\") = %q, want %q", c.name, err, "match_key required")
			}
			if len(fake.Pinned) != 0 {
				t.Errorf("%s(\"\") wrote to the store: %v", c.name, fake.Pinned)
			}
		})
	}
}
