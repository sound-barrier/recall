package app_test

import (
	"errors"
	"testing"

	"recall/pkg/app"
	"recall/pkg/db"
	"recall/pkg/match"
)

func TestResolveAmbiguousMatch_HappyPath(t *testing.T) {
	fs := &fakeStore{
		Teams: []db.TeamsRow{
			{Filename: "sb.png", MatchKey: "ambiguous-sb.png"},
		},
		Summaries: []db.SummaryRow{
			{Filename: "sum.png", MatchKey: "ambiguous-sb.png"},
		},
		Ambiguous: map[string][]db.AmbiguousCandidate{
			"sb.png": {{MatchKey: "match-foo", DistanceSeconds: 720}},
		},
	}
	a := app.NewWithStore(fs)
	if err := a.ResolveAmbiguousMatch("ambiguous-sb.png", "match-foo"); err != nil {
		t.Fatalf("ResolveAmbiguousMatch: %v", err)
	}
	if fs.Teams[0].MatchKey != "match-foo" {
		t.Errorf("teams not updated: %q", fs.Teams[0].MatchKey)
	}
	if fs.Summaries[0].MatchKey != "match-foo" {
		t.Errorf("summary not updated: %q", fs.Summaries[0].MatchKey)
	}
	if _, ok := fs.Ambiguous["sb.png"]; ok {
		t.Errorf("ambiguous record still present after resolve")
	}
}

func TestResolveAmbiguousMatch_RejectsKeyMissingPrefix(t *testing.T) {
	a := app.NewWithStore(&fakeStore{})
	err := a.ResolveAmbiguousMatch("match-foo", "match-bar")
	if !errors.Is(err, app.ErrInvalidAmbiguousKey) {
		t.Errorf("expected ErrInvalidAmbiguousKey, got %v", err)
	}
}

func TestResolveAmbiguousMatch_RejectsResolvedToNotInCandidates(t *testing.T) {
	fs := &fakeStore{
		Ambiguous: map[string][]db.AmbiguousCandidate{
			"sb.png": {{MatchKey: "match-foo", DistanceSeconds: 600}},
		},
	}
	a := app.NewWithStore(fs)
	err := a.ResolveAmbiguousMatch("ambiguous-sb.png", "bogus-key")
	if !errors.Is(err, app.ErrInvalidResolution) {
		t.Errorf("expected ErrInvalidResolution, got %v", err)
	}
}

func TestResolveAmbiguousMatch_AcceptsFreshMatchKey(t *testing.T) {
	// Escape hatch: user clicks "Treat as new match" → resolves to
	// a freshly-minted match:<ts> not in the candidate list.
	fs := &fakeStore{
		Teams: []db.TeamsRow{
			{Filename: "sb.png", MatchKey: "ambiguous-sb.png"},
		},
		Ambiguous: map[string][]db.AmbiguousCandidate{
			"sb.png": {{MatchKey: "match-other", DistanceSeconds: 720}},
		},
	}
	a := app.NewWithStore(fs)
	if err := a.ResolveAmbiguousMatch("ambiguous-sb.png", "match-2026-05-10T21-29-28"); err != nil {
		t.Errorf("expected fresh match:<ts> to be accepted, got %v", err)
	}
	if fs.Teams[0].MatchKey != "match-2026-05-10T21-29-28" {
		t.Errorf("teams not rewritten: %q", fs.Teams[0].MatchKey)
	}
}

func TestResolveAmbiguousMatch_NotFoundReturnsErr(t *testing.T) {
	a := app.NewWithStore(&fakeStore{})
	err := a.ResolveAmbiguousMatch("ambiguous-nope.png", "match-foo")
	if !errors.Is(err, app.ErrAmbiguousNotFound) {
		t.Errorf("expected ErrAmbiguousNotFound, got %v", err)
	}
}

// "Different match — keep separate" is a judgment the user made by reading
// two scoreboards, and it used to be recorded only as the absence of an
// ambiguity. Nothing on either card said the call had been made, so the
// next time they met one of them they had to make it again.
func TestResolveAmbiguousMatch_KeepSeparateRemembersTheJudgment(t *testing.T) {
	fs := &fakeStore{
		Teams: []db.TeamsRow{{Filename: "sb.png", MatchKey: "ambiguous-sb.png"}},
		Ambiguous: map[string][]db.AmbiguousCandidate{
			"sb.png": {{MatchKey: "match-orig", DistanceSeconds: 11321, Reason: "duplicate_stats"}},
		},
	}
	a := app.NewWithStore(fs)
	if err := a.ResolveAmbiguousMatch("ambiguous-sb.png", "match-2026-05-10T21-29-28"); err != nil {
		t.Fatalf("resolve: %v", err)
	}
	links, err := fs.LoadAllDuplicateLinks()
	if err != nil {
		t.Fatalf("load links: %v", err)
	}
	if got := links["match-2026-05-10T21-29-28"]; len(got) != 1 || got[0] != "match-orig" {
		t.Errorf("links = %v, want the kept match pointing at the original", links)
	}
}

// Merging is the opposite answer, and it leaves no link: the two ARE one
// match now, so there is nothing left to point at.
func TestResolveAmbiguousMatch_MergeLeavesNoLink(t *testing.T) {
	fs := &fakeStore{
		Teams: []db.TeamsRow{{Filename: "sb.png", MatchKey: "ambiguous-sb.png"}},
		Ambiguous: map[string][]db.AmbiguousCandidate{
			"sb.png": {{MatchKey: "match-orig", DistanceSeconds: 11321, Reason: "duplicate_stats"}},
		},
	}
	a := app.NewWithStore(fs)
	if err := a.ResolveAmbiguousMatch("ambiguous-sb.png", "match-orig"); err != nil {
		t.Fatalf("resolve: %v", err)
	}
	links, _ := fs.LoadAllDuplicateLinks()
	if len(links) != 0 {
		t.Errorf("links = %v, want none after a merge", links)
	}
}

// An ordinary EAD near-miss is not a duplicate claim — keeping it separate
// is routine attribution, and a "possible duplicate of" chip would be a
// claim nobody made.
func TestResolveAmbiguousMatch_KeepSeparateOnANearMissLinksNothing(t *testing.T) {
	fs := &fakeStore{
		Teams: []db.TeamsRow{{Filename: "sb.png", MatchKey: "ambiguous-sb.png"}},
		Ambiguous: map[string][]db.AmbiguousCandidate{
			"sb.png": {{MatchKey: "match-other", DistanceSeconds: 720}},
		},
	}
	a := app.NewWithStore(fs)
	if err := a.ResolveAmbiguousMatch("ambiguous-sb.png", "match-2026-05-10T21-29-28"); err != nil {
		t.Fatalf("resolve: %v", err)
	}
	links, _ := fs.LoadAllDuplicateLinks()
	if len(links) != 0 {
		t.Errorf("links = %v, want none for a plain attribution choice", links)
	}
}

// A screenshot parked as ambiguous keeps its candidate list only while the
// candidates exist: deleting a candidate match removes it from every list.
// Delete them all and the screenshot used to be stuck on the ambiguous
// sentinel for good — resolving it, even to a fresh match of its own,
// answered "not found" because no candidates were left.
func TestResolveAmbiguousMatch_StillResolvableOnceEveryCandidateIsGone(t *testing.T) {
	a := newRealApp(t)
	const candidate = "match-2026-05-10T21-29-28"
	const file = "Overwatch 2 Screenshot 2026.05.10 - 21.40.00.00.png"
	ambiguous := match.NewAmbiguousMatchKey(file).String()
	seedSummary(t, a, "c.png", candidate)
	seedSummary(t, a, file, ambiguous)
	mustNoErr(t, app.Store(a).ApplyAmbiguity(file, []db.AmbiguousCandidate{{MatchKey: candidate, DistanceSeconds: 660}}))

	mustNoErr(t, a.HardDeleteMatch(candidate))

	const fresh = "match-2026-05-10T21-40-00"
	if err := a.ResolveAmbiguousMatch(ambiguous, fresh); err != nil {
		t.Fatalf("resolving to a fresh match after the last candidate went: %v", err)
	}
	recs, err := a.GetMatchResults()
	mustNoErr(t, err)
	if len(recs) != 1 || recs[0].MatchKey != fresh {
		t.Errorf("matches after the resolve = %+v, want the one fresh match", recs)
	}
}

// With nothing parked under the sentinel there is nothing to resolve.
func TestResolveAmbiguousMatch_NothingParkedIsNotFound(t *testing.T) {
	a := newRealApp(t)
	ambiguous := match.NewAmbiguousMatchKey("gone.png").String()
	if err := a.ResolveAmbiguousMatch(ambiguous, "match-2026-05-10T21-40-00"); !errors.Is(err, app.ErrAmbiguousNotFound) {
		t.Errorf("ResolveAmbiguousMatch = %v, want ErrAmbiguousNotFound", err)
	}
}
