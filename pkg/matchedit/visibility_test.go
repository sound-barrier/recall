package matchedit_test

import (
	"errors"
	"testing"

	"recall/pkg/match"
	"recall/pkg/matchedit"
)

func TestHideAndUnhide_AreIdempotent(t *testing.T) {
	fake := seeded("m1")
	mustNoErr(t, matchedit.Hide(fake, "m1"))
	mustNoErr(t, matchedit.Hide(fake, "m1"))
	got, _ := fake.LoadHiddenKeys()
	if !got["m1"] {
		t.Errorf("m1 should be hidden, got %+v", got)
	}
	mustNoErr(t, matchedit.Unhide(fake, "m1"))
	mustNoErr(t, matchedit.Unhide(fake, "m1"))
	if got, _ := fake.LoadHiddenKeys(); got["m1"] {
		t.Errorf("m1 should be visible again, got %+v", got)
	}
}

func TestPinAndUnpin_AreIdempotent(t *testing.T) {
	fake := seeded("m1")
	mustNoErr(t, matchedit.Pin(fake, "m1"))
	mustNoErr(t, matchedit.Pin(fake, "m1"))
	got, _ := fake.LoadPinnedKeys()
	if !got["m1"] {
		t.Errorf("m1 should be pinned, got %+v", got)
	}
	mustNoErr(t, matchedit.Unpin(fake, "m1"))
	mustNoErr(t, matchedit.Unpin(fake, "m1"))
	if got, _ := fake.LoadPinnedKeys(); got["m1"] {
		t.Errorf("m1 should be unpinned, got %+v", got)
	}
}

// HardDelete cascades the sidecar rows with the match — the Hidden
// drawer's Delete is "gone", not "gone from the list".
func TestHardDelete_CascadesTheSidecars(t *testing.T) {
	fake := seeded("m1")
	mustNoErr(t, matchedit.SetReview(fake, "m1", "self"))
	mustNoErr(t, matchedit.SetQueue(fake, "m1", "role"))
	mustNoErr(t, matchedit.HardDelete(fake, "m1"))
	if got, _ := fake.LoadReviews(); len(got) != 0 {
		t.Errorf("review row should be cascaded; got %+v", got)
	}
	if got, _ := fake.LoadMatchQueues(); len(got) != 0 {
		t.Errorf("queue row should be cascaded; got %+v", got)
	}
	// Idempotent — deleting an already-deleted key is a no-op.
	mustNoErr(t, matchedit.HardDelete(fake, "m1"))
}

// Only the writes that CREATE a row are guarded; the removals stay
// idempotent on an unknown key, because the UI's fire-and-forget undo
// paths fire them without checking first.
func TestVisibility_GuardsCreatesButNotRemovals(t *testing.T) {
	const stray = "match-2030-01-01T00-00-00"
	creates := map[string]func() error{
		"Hide": func() error { return matchedit.Hide(seeded("known"), stray) },
		"Pin":  func() error { return matchedit.Pin(seeded("known"), stray) },
	}
	for name, create := range creates {
		if err := create(); !errors.Is(err, match.ErrMatchNotFound) {
			t.Errorf("%s on an unknown key = %v, want match.ErrMatchNotFound", name, err)
		}
	}
	removals := map[string]func() error{
		"Unhide":     func() error { return matchedit.Unhide(seeded("known"), stray) },
		"Unpin":      func() error { return matchedit.Unpin(seeded("known"), stray) },
		"HardDelete": func() error { return matchedit.HardDelete(seeded("known"), stray) },
	}
	for name, remove := range removals {
		if err := remove(); err != nil {
			t.Errorf("%s on an unknown key = %v, want a no-op", name, err)
		}
	}
}

func TestVisibilityWrites_RequireAMatchKey(t *testing.T) {
	fake := seeded("m1")
	writes := map[string]func(string) error{
		"Hide":       func(k string) error { return matchedit.Hide(fake, k) },
		"Unhide":     func(k string) error { return matchedit.Unhide(fake, k) },
		"Pin":        func(k string) error { return matchedit.Pin(fake, k) },
		"Unpin":      func(k string) error { return matchedit.Unpin(fake, k) },
		"HardDelete": func(k string) error { return matchedit.HardDelete(fake, k) },
	}
	for name, write := range writes {
		err := write("")
		if err == nil {
			t.Errorf("%s(\"\") succeeded, want an error", name)
			continue
		}
		if err.Error() != "match_key required" {
			t.Errorf("%s(\"\") = %q, want %q", name, err, "match_key required")
		}
	}
	if len(fake.Pinned) != 0 || len(fake.Hidden) != 0 {
		t.Errorf("an empty key reached the store: pinned=%v hidden=%v", fake.Pinned, fake.Hidden)
	}
}
