package matchedit_test

import (
	"errors"
	"testing"

	"recall/pkg/db/dbtest"
	"recall/pkg/matchedit"
)

// An empty match key is a malformed request, not a server fault. Every writer
// that takes one must say so with the same sentinel, or the HTTP layer cannot
// tell the difference between "you sent nothing" and "we broke" — it answers
// 500 for both.
func TestEveryWriter_RejectsAnEmptyKeyWithTheSameSentinel(t *testing.T) {
	s := dbtest.New()
	writers := map[string]func() error{
		"SetAnnotation":    func() error { return matchedit.SetAnnotation(s, matchedit.AnnotationInput{Note: "x"}) },
		"DeleteAnnotation": func() error { return matchedit.DeleteAnnotation(s, "") },
		"SetQueue":         func() error { return matchedit.SetQueue(s, "", "role") },
		"ClearQueue":       func() error { return matchedit.ClearQueue(s, "") },
		"SetPlayMode":      func() error { return matchedit.SetPlayMode(s, "", "quickplay") },
		"ClearPlayMode":    func() error { return matchedit.ClearPlayMode(s, "") },
		"SetReview":        func() error { return matchedit.SetReview(s, "", "self") },
		"ClearReview":      func() error { return matchedit.ClearReview(s, "") },
		"Hide":             func() error { return matchedit.Hide(s, "") },
		"Unhide":           func() error { return matchedit.Unhide(s, "") },
		"Pin":              func() error { return matchedit.Pin(s, "") },
		"Unpin":            func() error { return matchedit.Unpin(s, "") },
		"HardDelete":       func() error { return matchedit.HardDelete(s, "") },
		"ResetUserData":    func() error { return matchedit.ResetUserData(s, "") },
	}
	for name, call := range writers {
		if err := call(); !errors.Is(err, matchedit.ErrMatchKeyRequired) {
			t.Errorf("%s(\"\") = %v, want ErrMatchKeyRequired — a bare errors.New here is a 500 at the wire", name, err)
		}
	}
}
