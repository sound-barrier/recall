package matchedit_test

import (
	"errors"
	"testing"

	"recall/pkg/match"
	"recall/pkg/matchedit"
)

func TestSetQueue_PersistsValidValue(t *testing.T) {
	fake := seeded("m1", "m2")
	mustNoErr(t, matchedit.SetQueue(fake, "m1", "role"))
	mustNoErr(t, matchedit.SetQueue(fake, "m2", "open"))
	got, _ := fake.LoadMatchQueues()
	if got["m1"].QueueType != "role" || got["m2"].QueueType != "open" {
		t.Errorf("queues map wrong: %+v", got)
	}
}

func TestSetQueue_RejectsInvalidValue(t *testing.T) {
	fake := seeded("m1")
	for _, c := range []string{"", "ranked", "5v5", "ROLE", "role "} {
		if err := matchedit.SetQueue(fake, "m1", c); !errors.Is(err, matchedit.ErrInvalidQueueType) {
			t.Errorf("SetQueue(%q): err = %v, want ErrInvalidQueueType", c, err)
		}
	}
}

func TestBulkSetQueue_WritesEveryKey(t *testing.T) {
	fake := seeded("m1", "m2", "m3")
	mustNoErr(t, matchedit.BulkSetQueue(fake, []string{"m1", "m2", "m3"}, "role"))
	got, _ := fake.LoadMatchQueues()
	for _, k := range []string{"m1", "m2", "m3"} {
		if got[k].QueueType != "role" {
			t.Errorf("after bulk set, %s = %q, want role", k, got[k].QueueType)
		}
	}
}

func TestBulkSetQueue_EmptyValueClearsRows(t *testing.T) {
	fake := seeded("m1", "m2", "m3")
	mustNoErr(t, matchedit.SetQueue(fake, "m1", "role"))
	mustNoErr(t, matchedit.SetQueue(fake, "m2", "open"))
	mustNoErr(t, matchedit.SetQueue(fake, "m3", "role"))
	mustNoErr(t, matchedit.BulkSetQueue(fake, []string{"m1", "m3"}, ""))
	got, _ := fake.LoadMatchQueues()
	if _, ok := got["m1"]; ok {
		t.Errorf("m1 should have been cleared, got %+v", got["m1"])
	}
	if _, ok := got["m3"]; ok {
		t.Errorf("m3 should have been cleared, got %+v", got["m3"])
	}
	if got["m2"].QueueType != "open" {
		t.Errorf("m2 not in clear list, should still be open; got %q", got["m2"].QueueType)
	}
}

// The bulk writers are deliberately asymmetric about the unknown-key guard,
// and the direction is the reason: the SET direction creates rows, so a
// stale key would leave an orphan and the whole batch is refused; the CLEAR
// direction removes rows, so a stale key removes nothing and must stay a
// no-op — the archive drawer fires a bulk clear over a selection it has not
// re-validated. Asserting only the set half would let "make the guard
// consistent" break every undo path.
func TestBulkWrites_GuardTheSetDirectionOnly(t *testing.T) {
	const stray = "match-2030-01-01T00-00-00"
	sets := map[string]func() error{
		"BulkSetQueue": func() error {
			return matchedit.BulkSetQueue(seeded("known"), []string{"known", stray}, "role")
		},
		"BulkSetPlayMode": func() error {
			return matchedit.BulkSetPlayMode(seeded("known"), []string{"known", stray}, "competitive")
		},
	}
	for name, set := range sets {
		if err := set(); !errors.Is(err, match.ErrMatchNotFound) {
			t.Errorf("%s with a stray key = %v, want match.ErrMatchNotFound", name, err)
		}
	}

	clears := map[string]func() error{
		"BulkSetQueue":    func() error { return matchedit.BulkSetQueue(seeded("known"), []string{stray}, "") },
		"BulkSetPlayMode": func() error { return matchedit.BulkSetPlayMode(seeded("known"), []string{stray}, "") },
	}
	for name, clear := range clears {
		if err := clear(); err != nil {
			t.Errorf("%s clearing a stray key = %v, want a no-op", name, err)
		}
	}
}

// A refused batch writes NOTHING — the point of refusing whole is that a
// stray key in a selection cannot leave half of it tagged.
func TestBulkSetQueue_RefusedBatchWritesNothing(t *testing.T) {
	fake := seeded("known")
	if err := matchedit.BulkSetQueue(fake, []string{"known", "stray"}, "role"); !errors.Is(err, match.ErrMatchNotFound) {
		t.Fatalf("bulk with a stray key = %v, want match.ErrMatchNotFound", err)
	}
	if got, _ := fake.LoadMatchQueues(); len(got) != 0 {
		t.Errorf("the refused batch still wrote %+v", got)
	}
}

func TestBulkSetQueue_RejectsInvalidValue(t *testing.T) {
	err := matchedit.BulkSetQueue(seeded("m1"), []string{"m1"}, "ranked")
	if !errors.Is(err, matchedit.ErrInvalidQueueType) {
		t.Errorf("got %v, want ErrInvalidQueueType", err)
	}
}

func TestBulkSetQueue_EmptyKeysIsNoOp(t *testing.T) {
	fake := seeded()
	mustNoErr(t, matchedit.BulkSetQueue(fake, nil, "role"))
	mustNoErr(t, matchedit.BulkSetQueue(fake, []string{}, "role"))
	if got, _ := fake.LoadMatchQueues(); len(got) != 0 {
		t.Errorf("expected empty queues map, got %+v", got)
	}
}

func TestSetQueue_OverwritesExisting(t *testing.T) {
	fake := seeded("m1")
	mustNoErr(t, matchedit.SetQueue(fake, "m1", "role"))
	mustNoErr(t, matchedit.SetQueue(fake, "m1", "open"))
	got, _ := fake.LoadMatchQueues()
	if got["m1"].QueueType != "open" {
		t.Errorf("after overwrite, m1 = %q, want open", got["m1"].QueueType)
	}
}

func TestClearQueue_IsIdempotent(t *testing.T) {
	fake := seeded("m1")
	mustNoErr(t, matchedit.ClearQueue(fake, "never-set"))
	mustNoErr(t, matchedit.SetQueue(fake, "m1", "role"))
	mustNoErr(t, matchedit.ClearQueue(fake, "m1"))
	got, _ := fake.LoadMatchQueues()
	if _, ok := got["m1"]; ok {
		t.Errorf("m1 should be cleared, got %+v", got["m1"])
	}
	mustNoErr(t, matchedit.ClearQueue(fake, "m1"))
}

func TestQueueWrites_RequireAMatchKey(t *testing.T) {
	fake := seeded()
	if err := matchedit.SetQueue(fake, "", "role"); err == nil {
		t.Error("expected error for empty match_key")
	}
	if err := matchedit.ClearQueue(fake, ""); err == nil {
		t.Error("expected error for empty match_key on clear")
	}
}

func TestIsValidQueueType(t *testing.T) {
	for _, ok := range []string{"role", "open"} {
		if !matchedit.IsValidQueueType(ok) {
			t.Errorf("IsValidQueueType(%q) = false, want true", ok)
		}
	}
	// The empty string is "not set", which the manual form treats as
	// omission — it is NOT a stored value.
	for _, bad := range []string{"", "ranked", "5v5", "ROLE"} {
		if matchedit.IsValidQueueType(bad) {
			t.Errorf("IsValidQueueType(%q) = true, want false", bad)
		}
	}
}
