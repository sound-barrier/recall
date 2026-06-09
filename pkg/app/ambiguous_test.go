package app

import (
	"errors"
	"testing"

	"recall/pkg/db"
)

func TestResolveAmbiguousMatch_HappyPath(t *testing.T) {
	fs := &fakeStore{
		Scoreboards: []db.ScoreboardRow{
			{Filename: "sb.png", MatchKey: "ambiguous-sb.png"},
		},
		Summaries: []db.SummaryRow{
			{Filename: "sum.png", MatchKey: "ambiguous-sb.png"},
		},
		Ambiguous: map[string][]db.AmbiguousCandidate{
			"sb.png": {{MatchKey: "match-foo", DistanceSeconds: 720}},
		},
	}
	a := NewWithStore(fs)
	if err := a.ResolveAmbiguousMatch("ambiguous-sb.png", "match-foo"); err != nil {
		t.Fatalf("ResolveAmbiguousMatch: %v", err)
	}
	if fs.Scoreboards[0].MatchKey != "match-foo" {
		t.Errorf("scoreboard not updated: %q", fs.Scoreboards[0].MatchKey)
	}
	if fs.Summaries[0].MatchKey != "match-foo" {
		t.Errorf("summary not updated: %q", fs.Summaries[0].MatchKey)
	}
	if _, ok := fs.Ambiguous["sb.png"]; ok {
		t.Errorf("ambiguous record still present after resolve")
	}
}

func TestResolveAmbiguousMatch_RejectsKeyMissingPrefix(t *testing.T) {
	a := NewWithStore(&fakeStore{})
	err := a.ResolveAmbiguousMatch("match-foo", "match-bar")
	if !errors.Is(err, ErrInvalidAmbiguousKey) {
		t.Errorf("expected ErrInvalidAmbiguousKey, got %v", err)
	}
}

func TestResolveAmbiguousMatch_RejectsResolvedToNotInCandidates(t *testing.T) {
	fs := &fakeStore{
		Ambiguous: map[string][]db.AmbiguousCandidate{
			"sb.png": {{MatchKey: "match-foo", DistanceSeconds: 600}},
		},
	}
	a := NewWithStore(fs)
	err := a.ResolveAmbiguousMatch("ambiguous-sb.png", "bogus-key")
	if !errors.Is(err, ErrInvalidResolution) {
		t.Errorf("expected ErrInvalidResolution, got %v", err)
	}
}

func TestResolveAmbiguousMatch_AcceptsFreshMatchKey(t *testing.T) {
	// Escape hatch: user clicks "Treat as new match" → resolves to
	// a freshly-minted match:<ts> not in the candidate list.
	fs := &fakeStore{
		Scoreboards: []db.ScoreboardRow{
			{Filename: "sb.png", MatchKey: "ambiguous-sb.png"},
		},
		Ambiguous: map[string][]db.AmbiguousCandidate{
			"sb.png": {{MatchKey: "match-other", DistanceSeconds: 720}},
		},
	}
	a := NewWithStore(fs)
	if err := a.ResolveAmbiguousMatch("ambiguous-sb.png", "match-2026-05-10T21-29-28"); err != nil {
		t.Errorf("expected fresh match:<ts> to be accepted, got %v", err)
	}
	if fs.Scoreboards[0].MatchKey != "match-2026-05-10T21-29-28" {
		t.Errorf("scoreboard not rewritten: %q", fs.Scoreboards[0].MatchKey)
	}
}

func TestResolveAmbiguousMatch_NotFoundReturnsErr(t *testing.T) {
	a := NewWithStore(&fakeStore{})
	err := a.ResolveAmbiguousMatch("ambiguous-nope.png", "match-foo")
	if !errors.Is(err, ErrAmbiguousNotFound) {
		t.Errorf("expected ErrAmbiguousNotFound, got %v", err)
	}
}
