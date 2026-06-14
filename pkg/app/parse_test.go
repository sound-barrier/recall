package app_test

import (
	"errors"
	"testing"

	"recall/pkg/app"
)

func TestActiveParse_IdleByDefault(t *testing.T) {
	a := &app.App{}
	got := a.ActiveParse()
	if got.Running || got.Done != 0 || got.Total != 0 || got.Scope != "" {
		t.Errorf("idle ActiveParse = %+v, want zero/false", got)
	}
}

// claimParse is the single-flight gate: the first claim wins, a second
// fails fast (the source of the POST's 409 / the watcher's skip), and
// the slot frees on endParse. ActiveParse reflects each transition.
func TestClaimParse_SingleFlight(t *testing.T) {
	a := &app.App{}

	ctx, ok := app.ClaimParse(a, true)
	if !ok || ctx == nil {
		t.Fatalf("first claimParse = (%v, %v), want (ctx, true)", ctx, ok)
	}
	if s := a.ActiveParse(); !s.Running || s.Scope != "all" {
		t.Errorf("ActiveParse after claim = %+v, want running scope=all", s)
	}

	// A concurrent claim must fail fast — no queueing.
	if _, ok2 := app.ClaimParse(a, false); ok2 {
		t.Errorf("second claimParse succeeded, want fail-fast")
	}

	app.EndParse(a)
	if s := a.ActiveParse(); s.Running {
		t.Errorf("ActiveParse after endParse = %+v, want not running", s)
	}

	// Slot is reusable after release.
	if _, ok3 := app.ClaimParse(a, false); !ok3 {
		t.Errorf("claimParse after endParse failed, want reusable slot")
	}
	app.EndParse(a)
}

func TestNoteProgress_SurfacedByActiveParse(t *testing.T) {
	a := &app.App{}
	if _, ok := app.ClaimParse(a, false); !ok {
		t.Fatal("claimParse failed")
	}
	defer app.EndParse(a)

	app.NoteProgress(a, 7, 40)
	if s := a.ActiveParse(); s.Done != 7 || s.Total != 40 || s.Scope != "new" {
		t.Errorf("ActiveParse after noteProgress = %+v, want done=7 total=40 scope=new", s)
	}
}

// CancelParse still works against the new claim-based state: claiming
// sets the cancel func, so CancelParse finds it; after endParse the slot
// is empty again.
func TestCancelParse_AgainstClaimedState(t *testing.T) {
	a := &app.App{}
	if _, ok := app.ClaimParse(a, false); !ok {
		t.Fatal("claimParse failed")
	}
	if err := a.CancelParse(); err != nil {
		t.Errorf("CancelParse while claimed = %v, want nil", err)
	}
	app.EndParse(a)
	if err := a.CancelParse(); !errors.Is(err, app.ErrNoParseInFlight) {
		t.Errorf("CancelParse after endParse = %v, want ErrNoParseInFlight", err)
	}
}
