package seed_test

import (
	"errors"
	"testing"

	"recall/pkg/db"
	"recall/pkg/db/dbtest"
	"recall/pkg/seed"
)

// keepOrClearExisting is the one destructive decision in a seed run: it either
// preserves a profile's rows or wipes them. In production it is reachable only
// through a whole profile seed, so the matrix below — five row kinds × Force —
// was never asserted directly.

// rowKinds seeds a Fake with exactly one row of a single kind, so each arm of
// the "does this profile already hold data?" sum is checked on its own. A kind
// dropped from that sum is a profile that reads as EMPTY and gets silently
// overwritten on the next seed.
var rowKinds = []struct {
	name string
	seed func(*dbtest.Fake)
}{
	{"summary", func(f *dbtest.Fake) { f.Summaries = []db.SummaryRow{{MatchKey: "k1", Filename: "a.png"}} }},
	{"teams", func(f *dbtest.Fake) { f.Teams = []db.TeamsRow{{MatchKey: "k1", Filename: "a.png"}} }},
	{"personal", func(f *dbtest.Fake) { f.Personals = []db.PersonalRow{{MatchKey: "k1", Filename: "a.png"}} }},
	{"rank", func(f *dbtest.Fake) { f.Ranks = []db.RankRow{{MatchKey: "k1", Filename: "a.png"}} }},
	{"unknown", func(f *dbtest.Fake) { f.Unknowns = []db.UnknownRow{{Filename: "a.png"}} }},
}

// Without Force, ANY existing row of ANY kind must stop the seed. A profile
// holding only unknown screenshots still holds the user's data.
func TestKeepOrClearExisting_KeepsEveryRowKindWithoutForce(t *testing.T) {
	for _, kind := range rowKinds {
		t.Run(kind.name, func(t *testing.T) {
			fake := &dbtest.Fake{}
			kind.seed(fake)

			kept, _, err := seed.KeepOrClearExisting(fake, false)
			if err != nil {
				t.Fatalf("KeepOrClearExisting: %v", err)
			}
			if !kept {
				t.Errorf("a profile holding a %s row reported kept=false — the seed would overwrite it", kind.name)
			}
			if fake.ClearCalls != 0 {
				t.Errorf("Clear called %d times without Force", fake.ClearCalls)
			}
		})
	}
}

// With Force, ANY existing row of ANY kind must be wiped — a merge would
// interleave two generations of fixtures.
func TestKeepOrClearExisting_ClearsEveryRowKindWithForce(t *testing.T) {
	for _, kind := range rowKinds {
		t.Run(kind.name, func(t *testing.T) {
			fake := &dbtest.Fake{}
			kind.seed(fake)

			kept, existing, err := seed.KeepOrClearExisting(fake, true)
			if err != nil {
				t.Fatalf("KeepOrClearExisting: %v", err)
			}
			if kept {
				t.Fatalf("Force reported kept=true for a %s row — it reused instead of reseeding", kind.name)
			}
			if existing != 0 {
				t.Errorf("Force reported %d existing matches, want 0 — the store was just wiped", existing)
			}
			if fake.ClearCalls != 1 {
				t.Errorf("Clear called %d times, want exactly 1", fake.ClearCalls)
			}
		})
	}
}

// An empty profile is the fresh-install path: proceed, and do NOT spend a
// Clear on a store with nothing in it (Force must not change that).
func TestKeepOrClearExisting_EmptyStoreProceedsWithoutClearing(t *testing.T) {
	for _, force := range []bool{false, true} {
		fake := &dbtest.Fake{}
		kept, existing, err := seed.KeepOrClearExisting(fake, force)
		if err != nil {
			t.Fatalf("force=%v: %v", force, err)
		}
		if kept || existing != 0 {
			t.Errorf("force=%v: empty store reported kept=%v existing=%d, want false/0", force, kept, existing)
		}
		if fake.ClearCalls != 0 {
			t.Errorf("force=%v: Clear called %d times on an empty store", force, fake.ClearCalls)
		}
	}
}

// The kept path reports the SUMMARY count, which is what the caller surfaces
// as "profile %q already contains %d matches". Rows of other kinds gate the
// decision but are not matches.
func TestKeepOrClearExisting_KeptCountIsTheSummaryCount(t *testing.T) {
	fake := &dbtest.Fake{
		Summaries: []db.SummaryRow{{MatchKey: "k1"}, {MatchKey: "k2"}, {MatchKey: "k3"}},
		Teams:     []db.TeamsRow{{MatchKey: "k1"}},
		Unknowns:  []db.UnknownRow{{Filename: "u.png"}},
	}
	kept, existing, err := seed.KeepOrClearExisting(fake, false)
	if err != nil {
		t.Fatalf("KeepOrClearExisting: %v", err)
	}
	if !kept {
		t.Fatal("kept=false with rows present")
	}
	if existing != 3 {
		t.Errorf("existing = %d, want 3 (the summary count, not the total row count)", existing)
	}
}

// A read failure must abort the seed, not fall through to the wipe. Reading
// "no rows" out of a broken store and then clearing it is how a seed run
// destroys a profile it could not inspect.
func TestKeepOrClearExisting_ReadFailureAbortsBeforeClearing(t *testing.T) {
	sentinel := errors.New("disk is on fire")
	for _, force := range []bool{false, true} {
		fake := &dbtest.Fake{LoadErr: sentinel}
		kept, existing, err := seed.KeepOrClearExisting(fake, force)
		if !errors.Is(err, sentinel) {
			t.Fatalf("force=%v: error = %v, want it to wrap the store failure", force, err)
		}
		if kept || existing != 0 {
			t.Errorf("force=%v: failed read reported kept=%v existing=%d, want false/0", force, kept, existing)
		}
		if fake.ClearCalls != 0 {
			t.Errorf("force=%v: Clear called %d times after a failed read — an uninspectable profile was wiped", force, fake.ClearCalls)
		}
	}
}
