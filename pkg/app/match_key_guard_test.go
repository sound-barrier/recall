package app_test

import (
	"errors"
	"testing"

	"recall/pkg/app"
	"recall/pkg/match"
)

// Design rule 2: a per-match write naming a key this database has never
// seen creates an orphan row nothing will ever read back. Every writer
// that CREATES a row refuses one; every writer that removes one stays
// idempotent, because removing nothing is harmless and the UI's
// fire-and-forget undo paths rely on it.

const strayKey = "match-2030-01-01T00-00-00"

// rowCreatingWrites are the per-match writers that insert.
func rowCreatingWrites(a *app.App) map[string]func(string) error {
	return map[string]func(string) error{
		"SetMatchAnnotation": func(k string) error { return a.SetMatchAnnotation(app.AnnotationInput{MatchKey: k, Note: "n"}) },
		"SetMatchReview":     func(k string) error { return a.SetMatchReview(k, "self") },
		"SetMatchQueue":      func(k string) error { return a.SetMatchQueue(k, "role") },
		"SetMatchPlayMode":   func(k string) error { return a.SetMatchPlayMode(k, "competitive") },
		"HideMatch":          a.HideMatch,
		"PinMatch":           a.PinMatch,
		"UpdateMatchData": func(k string) error {
			edited := "dorado"
			return a.UpdateMatchData(k, match.UserMatchDataInput{Map: &edited})
		},
		"BulkSetMatchQueue":    func(k string) error { return a.BulkSetMatchQueue([]string{k}, "role") },
		"BulkSetMatchPlayMode": func(k string) error { return a.BulkSetMatchPlayMode([]string{k}, "competitive") },
	}
}

func TestPerMatchWrites_RefuseAnUnknownKey(t *testing.T) {
	fs := &fakeStore{}
	a := app.NewWithStore(fs)
	seedMatchKeys(fs, "known")
	for name, write := range rowCreatingWrites(a) {
		if err := write(strayKey); !errors.Is(err, match.ErrMatchNotFound) {
			t.Errorf("%s on an unknown key = %v, want match.ErrMatchNotFound", name, err)
		}
	}
	assertNoOrphanRows(t, fs)
}

func TestPerMatchWrites_AcceptAKnownKey(t *testing.T) {
	fs := &fakeStore{}
	a := app.NewWithStore(fs)
	seedMatchKeys(fs, "known")
	for name, write := range rowCreatingWrites(a) {
		if err := write("known"); err != nil {
			t.Errorf("%s on a known key = %v, want it to go through", name, err)
		}
	}
}

// assertNoOrphanRows proves the refusals wrote nothing at all — the point
// of the rule, not just the error value.
func assertNoOrphanRows(t *testing.T, fs *fakeStore) {
	t.Helper()
	annos := mustGet(fs.LoadAnnotations())
	reviews := mustGet(fs.LoadReviews())
	queues := mustGet(fs.LoadMatchQueues())
	playModes := mustGet(fs.LoadMatchPlayModes())
	hidden := mustGet(fs.LoadHiddenKeys())
	pinned := mustGet(fs.LoadPinnedKeys())
	userData := mustGet(fs.LoadAllUserMatchData())
	counts := map[string]int{
		"annotations": len(annos), "reviews": len(reviews), "queues": len(queues),
		"play modes": len(playModes), "hidden": len(hidden), "pinned": len(pinned),
		"user data": len(userData),
	}
	for layer, n := range counts {
		if n != 0 {
			t.Errorf("%s carries %d orphan row(s) after a refused write", layer, n)
		}
	}
}

// A bulk write is refused WHOLE — a stray key in the selection must not
// leave half the batch tagged.
func TestBulkWrites_RefuseTheWholeBatchOnOneUnknownKey(t *testing.T) {
	fs := &fakeStore{}
	a := app.NewWithStore(fs)
	seedMatchKeys(fs, "known")
	if err := a.BulkSetMatchQueue([]string{"known", strayKey}, "role"); !errors.Is(err, match.ErrMatchNotFound) {
		t.Fatalf("bulk with a stray key = %v, want match.ErrMatchNotFound", err)
	}
	if got := mustGet(fs.LoadMatchQueues()); len(got) != 0 {
		t.Errorf("the refused batch still wrote %+v", got)
	}
}

// Removals stay idempotent on unknown keys — they create nothing, and the
// undo paths fire them without checking first.
func TestPerMatchRemovals_StayIdempotentOnAnUnknownKey(t *testing.T) {
	a := app.NewWithStore(&fakeStore{})
	removals := map[string]func() error{
		"DeleteMatchAnnotation": func() error { return a.DeleteMatchAnnotation(strayKey) },
		"ClearMatchReview":      func() error { return a.ClearMatchReview(strayKey) },
		"ClearMatchQueue":       func() error { return a.ClearMatchQueue(strayKey) },
		"ClearMatchPlayMode":    func() error { return a.ClearMatchPlayMode(strayKey) },
		"UnhideMatch":           func() error { return a.UnhideMatch(strayKey) },
		"UnpinMatch":            func() error { return a.UnpinMatch(strayKey) },
		"HardDeleteMatch":       func() error { return a.HardDeleteMatch(strayKey) },
		"ResetMatchData":        func() error { return a.ResetMatchData(strayKey) },
		"BulkSetMatchQueue":     func() error { return a.BulkSetMatchQueue([]string{strayKey}, "") },
		"BulkSetMatchPlayMode":  func() error { return a.BulkSetMatchPlayMode([]string{strayKey}, "") },
	}
	for name, remove := range removals {
		if err := remove(); err != nil {
			t.Errorf("%s on an unknown key = %v, want a no-op", name, err)
		}
	}
}
