package coach_test

import (
	"errors"
	"testing"
	"time"

	"recall/pkg/coach"
	"recall/pkg/match"
)

var replayNow = time.Date(2026, 8, 15, 9, 12, 0, 0, time.UTC)

// The session a coach opens when all they were handed is replay codes. There
// is no bundle, no screenshot and no player identity in the payload — the
// codes ARE the payload.
func TestOpenReplaySession_BuildsAFrameForEachCode(t *testing.T) {
	s, err := coach.OpenReplaySession([]string{"a1b2c3", " D4E5F6 "}, replayNow)
	if err != nil {
		t.Fatalf("OpenReplaySession: %v", err)
	}
	if s.MatchCount() != 2 {
		t.Fatalf("MatchCount = %d, want 2", s.MatchCount())
	}
	for _, want := range []string{"replay-A1B2C3", "replay-D4E5F6"} {
		if !s.HasMatch(want) {
			t.Errorf("session is missing %s", want)
		}
	}
	// The reel orders by key, and the notes gate reads HasMatch — both work
	// off the same canonical form, so a coach typing lowercase and a player
	// importing later meet on the same key.
	if got := s.Records()[0].MatchKey; got != "replay-A1B2C3" {
		t.Errorf("first record = %q, want replay-A1B2C3", got)
	}
}

// Nobody has confirmed who this is about, so the room must still ask. A
// replay session carries no bundle and therefore no handle: HandleFromBundle
// is false and ErrHandleRequired keeps the first write out until the coach
// says who they are coaching.
func TestOpenReplaySession_HasNoPlayerUntilTheCoachSaysSo(t *testing.T) {
	s, err := coach.OpenReplaySession([]string{"A1B2C3"}, replayNow)
	if err != nil {
		t.Fatalf("OpenReplaySession: %v", err)
	}
	if s.HandleFromBundle {
		t.Error("a replay session has no bundle, so it cannot have a handle from one")
	}
	if s.Player.Handle != "" {
		t.Errorf("Player.Handle = %q, want empty", s.Player.Handle)
	}
}

func TestOpenReplaySession_Refuses(t *testing.T) {
	cases := map[string]struct {
		codes []string
		want  error
	}{
		"no codes at all":  {nil, coach.ErrNoReplayCodes},
		"only blanks":      {[]string{"", "   "}, coach.ErrNoReplayCodes},
		"a malformed code": {[]string{"A1B2C3", "NOPE"}, match.ErrInvalidReplayCode},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := coach.OpenReplaySession(c.codes, replayNow); !errors.Is(err, c.want) {
				t.Fatalf("err = %v, want %v", err, c.want)
			}
		})
	}
}

// The same replay watched twice is one match, so the reel shows one frame.
func TestOpenReplaySession_DedupesCodes(t *testing.T) {
	s, err := coach.OpenReplaySession([]string{"A1B2C3", "a1b2c3", "A1B2C3"}, replayNow)
	if err != nil {
		t.Fatalf("OpenReplaySession: %v", err)
	}
	if s.MatchCount() != 1 {
		t.Errorf("MatchCount = %d, want 1 — one code is one match", s.MatchCount())
	}
}

// Codes arrive one at a time over voice chat, so the reel grows while the
// coach works.
func TestSession_AddReplayCode(t *testing.T) {
	s, _ := coach.OpenReplaySession([]string{"A1B2C3"}, replayNow)

	if err := s.AddReplayCode("d4e5f6"); err != nil {
		t.Fatalf("AddReplayCode: %v", err)
	}
	if !s.HasMatch("replay-D4E5F6") || s.MatchCount() != 2 {
		t.Errorf("after adding, MatchCount = %d and D4E5F6 present = %v", s.MatchCount(), s.HasMatch("replay-D4E5F6"))
	}
	// Adding one already in the reel is a no-op, not a duplicate frame.
	if err := s.AddReplayCode("A1B2C3"); err != nil {
		t.Fatalf("re-adding an existing code: %v", err)
	}
	if s.MatchCount() != 2 {
		t.Errorf("MatchCount = %d after re-adding, want 2", s.MatchCount())
	}
	if err := s.AddReplayCode("NOPE"); !errors.Is(err, match.ErrInvalidReplayCode) {
		t.Errorf("AddReplayCode(malformed) = %v, want ErrInvalidReplayCode", err)
	}
}

// A bundle session cannot grow: its corpus is what the player loaned.
func TestSession_AddReplayCodeRefusedOnABundleSession(t *testing.T) {
	s := openSeededSession(t, nil)
	if err := s.AddReplayCode("A1B2C3"); !errors.Is(err, coach.ErrNotAReplaySession) {
		t.Errorf("err = %v, want ErrNotAReplaySession", err)
	}
}

// What the coach saw, so the artifact reads like a match card and the
// player's side has something to create the match from.
func TestSession_SetObservedContext(t *testing.T) {
	s, _ := coach.OpenReplaySession([]string{"A1B2C3"}, replayNow)

	err := s.SetObservedContext("replay-A1B2C3", coach.ObservedContext{
		Map: "ilios", Hero: "ana", Result: "victory", Date: "2026-08-15", FinishedAt: "18:30",
	})
	if err != nil {
		t.Fatalf("SetObservedContext: %v", err)
	}
	ctx := s.MatchContextFor("replay-A1B2C3")
	if ctx == nil {
		t.Fatal("MatchContextFor returned nil for a match in the session")
	}
	if ctx.Map != "ilios" || ctx.Hero != "ana" || ctx.Result != "victory" {
		t.Errorf("context = %+v, want the observed values", ctx)
	}
	// The code rides along, because on the player's side it is the only
	// thing identifying the match the note is about.
	if ctx.ReplayCode != "A1B2C3" {
		t.Errorf("ReplayCode = %q, want A1B2C3", ctx.ReplayCode)
	}
}

// Only omission is free — the same doctrine the manual-match form states.
// A value the coach DID supply has to be one the player's import will
// accept, or they fill in a form and the handoff 400s on the far side.
func TestSession_SetObservedContextValidates(t *testing.T) {
	s, _ := coach.OpenReplaySession([]string{"A1B2C3"}, replayNow)
	cases := map[string]coach.ObservedContext{
		"unknown map":    {Map: "not-a-real-map"},
		"unknown hero":   {Hero: "not-a-real-hero"},
		"invalid result": {Result: "sideways"},
		"invalid date":   {Date: "15/08/2026"},
		"invalid clock":  {FinishedAt: "25:99"},
	}
	for name, ctx := range cases {
		t.Run(name, func(t *testing.T) {
			if err := s.SetObservedContext("replay-A1B2C3", ctx); err == nil {
				t.Fatalf("SetObservedContext(%+v) = nil, want a refusal", ctx)
			}
		})
	}
	if err := s.SetObservedContext("replay-A1B2C3", coach.ObservedContext{}); err != nil {
		t.Errorf("an entirely empty context is legal (the coach saw nothing worth recording): %v", err)
	}
}

func TestSession_SetObservedContextRefusesAKeyNotInTheSession(t *testing.T) {
	s, _ := coach.OpenReplaySession([]string{"A1B2C3"}, replayNow)
	if err := s.SetObservedContext("replay-Z9Y8X7", coach.ObservedContext{Map: "ilios"}); err == nil {
		t.Error("SetObservedContext accepted a key the session does not hold")
	}
}
