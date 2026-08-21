package coach_test

import (
	"regexp"
	"testing"

	"recall/pkg/coach"
	"recall/pkg/coachreturn"
)

// The vocabulary is the contract the schema CHECK, the frontend chips, and
// every note validation share — spelled literally here so a silent edit to
// the slice fails a test instead of traveling through it.
func TestFocusTags_VocabularyIsPinned(t *testing.T) {
	want := []string{"positioning", "ult_economy", "target_priority", "cooldowns", "hero_pick", "comms", "mechanics", "mental"}
	if len(coach.FocusTags) != len(want) {
		t.Fatalf("FocusTags = %v, want %v", coach.FocusTags, want)
	}
	for i, tag := range want {
		if coach.FocusTags[i] != tag {
			t.Errorf("FocusTags[%d] = %q, want %q", i, coach.FocusTags[i], tag)
		}
		if !coach.IsFocusTag(tag) {
			t.Errorf("IsFocusTag(%q) = false", tag)
		}
	}
	for _, bad := range []string{"", "Positioning", "ult economy", "tempo"} {
		if coach.IsFocusTag(bad) {
			t.Errorf("IsFocusTag(%q) = true, want false", bad)
		}
	}
}

var uuidV4Shape = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func TestNewID_MintsLowercaseUUIDv4(t *testing.T) {
	seen := map[string]bool{}
	for range 64 {
		id := coach.NewID()
		if !uuidV4Shape.MatchString(id) {
			t.Fatalf("NewID() = %q, not a lowercase v4 UUID", id)
		}
		if !coach.IsUUID(id) {
			t.Fatalf("IsUUID(NewID()=%q) = false", id)
		}
		if seen[id] {
			t.Fatalf("NewID() repeated %q", id)
		}
		seen[id] = true
	}
}

func TestIsUUID(t *testing.T) {
	tests := []struct {
		in   string
		want bool
	}{
		{"a3f1c2d4-8e9b-4a7c-b6d5-1f2e3d4c5b6a", true},
		{"A3F1C2D4-8E9B-4A7C-B6D5-1F2E3D4C5B6A", true},
		{"", false},
		{"a3f1c2d4-8e9b-4a7c-b6d5-1f2e3d4c5b6", false},
		{"a3f1c2d48e9b4a7cb6d51f2e3d4c5b6a", false},
		{"g3f1c2d4-8e9b-4a7c-b6d5-1f2e3d4c5b6a", false},
		{"a3f1c2d4_8e9b_4a7c_b6d5_1f2e3d4c5b6a", false},
	}
	for _, tc := range tests {
		if got := coach.IsUUID(tc.in); got != tc.want {
			t.Errorf("IsUUID(%q) = %v, want %v", tc.in, got, tc.want)
		}
	}
}

// Every sentinel the app wave maps to an HTTP status must be distinct, so
// errors.Is ladders can never conflate two outcomes.
func TestSentinels_AreDistinct(t *testing.T) {
	sentinels := []error{
		coach.ErrNoSession, coach.ErrSessionActive, coach.ErrNotABundle, coach.ErrNoteInvalid,
		coach.ErrHandleInvalid, coach.ErrHandleRequired, coach.ErrMatchNotInSession,
		coach.ErrNotesMalformed, coach.ErrNotesUnsupportedSchema, coachreturn.ErrOrphan,
		coachreturn.ErrNoMatches, coach.ErrCoachNameRequired, coach.ErrNothingToExport,
	}
	seen := map[string]bool{}
	for _, err := range sentinels {
		if err == nil {
			t.Fatal("nil sentinel")
		}
		if seen[err.Error()] {
			t.Errorf("duplicate sentinel message %q", err.Error())
		}
		seen[err.Error()] = true
	}
}
