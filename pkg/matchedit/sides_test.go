package matchedit_test

import (
	"testing"

	"recall/pkg/matchedit"
)

// normalizeSides skips empties and duplicates, but nothing exercised either
// arm — gobco reported the branch as never taken across 23 evaluations. Two
// questions follow: does a duplicate survive, and does an all-empty list
// arrive as the same "not tagged" state an absent list does?
func TestSetAnnotation_DisruptionSidesDedupeAndEmpty(t *testing.T) {
	s := seeded("match-2026-01-01T00-00-00")

	t.Run("duplicates collapse", func(t *testing.T) {
		err := matchedit.SetAnnotation(s, matchedit.AnnotationInput{
			MatchKey: "match-2026-01-01T00-00-00",
			Leavers:  []string{"self", "self", "team"},
		})
		if err != nil {
			t.Fatalf("SetAnnotation: %v", err)
		}
		got, _ := s.LoadAnnotations()
		if n := len(got["match-2026-01-01T00-00-00"].Leavers); n != 2 {
			t.Errorf("leavers = %v (%d), want 2 after dedupe", got["match-2026-01-01T00-00-00"].Leavers, n)
		}
	})

	t.Run("an all-empty list reads as not tagged", func(t *testing.T) {
		err := matchedit.SetAnnotation(s, matchedit.AnnotationInput{
			MatchKey: "match-2026-01-01T00-00-00",
			Note:     "keeps the annotation alive",
			Leavers:  []string{"", "   "},
		})
		if err != nil {
			t.Fatalf("SetAnnotation: %v", err)
		}
		got, _ := s.LoadAnnotations()
		if n := len(got["match-2026-01-01T00-00-00"].Leavers); n != 0 {
			t.Errorf("leavers = %v, want empty for an all-blank list", got["match-2026-01-01T00-00-00"].Leavers)
		}
	})
}
