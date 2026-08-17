package matchedit_test

import (
	"errors"
	"testing"

	"recall/pkg/db"
	"recall/pkg/db/dbtest"
	"recall/pkg/match"
	"recall/pkg/matchedit"
)

// seeded returns a fake store that already holds a screenshot row per
// key, so the unknown-key guard sees a match there. Tests that only care
// about a sidecar's own behavior use this to state "these matches exist"
// without spelling out a corpus.
func seeded(keys ...string) *dbtest.Fake {
	fake := dbtest.New()
	for _, key := range keys {
		fake.Summaries = append(fake.Summaries, db.SummaryRow{Filename: key + ".png", MatchKey: key})
	}
	return fake
}

// mustNoErr fails the test when a setup or exercise step errors.
func mustNoErr(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

// The unknown-key guard, at the leaf. The *App-level twin in
// pkg/app/match_key_guard_test.go proves the shell still routes through
// it; this pins the rule itself.

func TestAssertMatchExists(t *testing.T) {
	fake := seeded("known")
	mustNoErr(t, matchedit.AssertMatchExists(fake, "known"))
	if err := matchedit.AssertMatchExists(fake, "stray"); !errors.Is(err, match.ErrMatchNotFound) {
		t.Errorf("AssertMatchExists(stray) = %v, want match.ErrMatchNotFound", err)
	}
}

// The guard names the offending key, so a refused bulk write tells the
// user which selection member was stale rather than just "not found".
func TestAssertMatchExists_NamesTheKey(t *testing.T) {
	err := matchedit.AssertMatchExists(seeded("known"), "match-2030-01-01T00-00-00")
	if err == nil {
		t.Fatal("AssertMatchExists on an unknown key succeeded")
	}
	if got := err.Error(); got != "match not found: match-2030-01-01T00-00-00" {
		t.Errorf("err = %q, want it to name the key", got)
	}
}
