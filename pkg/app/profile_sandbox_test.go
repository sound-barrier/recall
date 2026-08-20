package app_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"recall/pkg/app"
	"recall/pkg/match"
	"recall/pkg/review"
)

// The tour's "test" profile is a SANDBOX, not a museum. It used to be marked
// immutable, which read as breakage: a player who took the tour and stayed to
// look around found six greyed buttons whose only explanation was a hover
// tooltip. The contract now: seeded like before, writable like any profile,
// and DELETING it removes everything it ever held — deletion is the reset.
func TestSeedTestProfile_IsAWritableSandbox(t *testing.T) {
	a := sandboxApp(t)

	if _, err := a.SeedTestProfile(); err != nil {
		t.Fatalf("SeedTestProfile: %v", err)
	}
	if err := a.SwitchProfile("test"); err != nil {
		t.Fatalf("SwitchProfile(test): %v", err)
	}

	// The two writes that confused a real user: a manual match and a
	// self-review sitting. Both are ordinary writes on the sandbox.
	created, err := a.CreateManualMatch(match.ManualMatchInput{
		Map: "rialto", Result: "victory", PlayedAt: "2026-08-01T20:00:00-06:00",
	})
	if err != nil {
		t.Fatalf("CreateManualMatch on the sandbox = %v, want success", err)
	}
	if _, err := a.CreateSelfReview(review.CreateInput{MatchKeys: []string{created.MatchKey}}); err != nil {
		t.Fatalf("CreateSelfReview on the sandbox = %v, want success", err)
	}
	// And a move INTO the sandbox is a move like any other (it used to refuse).
	if err := a.SwitchProfile("main"); err != nil {
		t.Fatalf("SwitchProfile(main): %v", err)
	}
	if _, err := a.CreateManualMatch(match.ManualMatchInput{
		Map: "ilios", Result: "defeat", PlayedAt: "2026-08-02T21:00:00-06:00",
	}); err != nil {
		t.Fatalf("CreateManualMatch on main: %v", err)
	}
}

// Deleting the sandbox removes EVERYTHING — the seeded matches, whatever the
// user added while exploring, its settings, its whole directory — and a
// re-seed starts fresh. Deletion is the documented way back to pristine.
func TestDeleteProfile_RemovesTheWholeSandbox(t *testing.T) {
	a := sandboxApp(t)

	if _, err := a.SeedTestProfile(); err != nil {
		t.Fatalf("SeedTestProfile: %v", err)
	}
	if err := a.SwitchProfile("test"); err != nil {
		t.Fatalf("SwitchProfile(test): %v", err)
	}
	if _, err := a.CreateManualMatch(match.ManualMatchInput{
		Map: "rialto", Result: "victory", PlayedAt: "2026-08-01T20:00:00-06:00",
	}); err != nil {
		t.Fatalf("modify the sandbox: %v", err)
	}

	// The active profile cannot be deleted — the reset path goes through
	// your own profile first, and the refusal names it.
	if err := a.DeleteProfile("test"); !errors.Is(err, app.ErrProfileActive) {
		t.Fatalf("DeleteProfile(active) = %v, want ErrProfileActive", err)
	}
	if err := a.SwitchProfile("main"); err != nil {
		t.Fatalf("SwitchProfile(main): %v", err)
	}
	assertSandboxFullyRemoved(t, a)
}

// assertSandboxFullyRemoved deletes the sandbox and proves nothing survives:
// the directory, the listing entry, and — via a fresh re-seed — any state a
// leftover could have resurrected.
func assertSandboxFullyRemoved(t *testing.T, a *app.App) {
	t.Helper()
	profileDir := filepath.Join(os.Getenv("RECALL_DATA_DIR"), "profiles", "test")
	if _, err := os.Stat(profileDir); err != nil {
		t.Fatalf("sandbox dir missing before delete: %v", err)
	}
	if err := a.DeleteProfile("test"); err != nil {
		t.Fatalf("DeleteProfile(test): %v", err)
	}
	if _, err := os.Stat(profileDir); !os.IsNotExist(err) {
		t.Fatalf("sandbox dir still present after delete (err=%v) — delete must remove everything", err)
	}
	if got := a.GetProfiles(); slices.Contains(got.Profiles, "test") {
		t.Fatalf("profiles still list test after delete: %v", got.Profiles)
	}
	res, err := a.SeedTestProfile()
	if err != nil {
		t.Fatalf("re-seed after delete: %v", err)
	}
	if res.AlreadySeeded {
		t.Fatal("re-seed after delete reported AlreadySeeded — leftovers survived the delete")
	}
}

// Replaying the tour over a MODIFIED sandbox keeps the user's work: seeding
// is idempotent, never a wipe. Deleting the profile is the explicit reset.
func TestSeedTestProfile_ReplayKeepsModifications(t *testing.T) {
	a := sandboxApp(t)

	if _, err := a.SeedTestProfile(); err != nil {
		t.Fatalf("SeedTestProfile: %v", err)
	}
	if err := a.SwitchProfile("test"); err != nil {
		t.Fatalf("SwitchProfile(test): %v", err)
	}
	created, err := a.CreateManualMatch(match.ManualMatchInput{
		Map: "rialto", Result: "victory", PlayedAt: "2026-08-01T20:00:00-06:00",
	})
	if err != nil {
		t.Fatalf("modify the sandbox: %v", err)
	}

	res, err := a.SeedTestProfile()
	if err != nil {
		t.Fatalf("replay seed: %v", err)
	}
	if !res.AlreadySeeded {
		t.Fatal("replay seed did not report AlreadySeeded")
	}
	records, err := a.GetMatchResults()
	if err != nil {
		t.Fatalf("GetMatchResults: %v", err)
	}
	if !slices.ContainsFunc(records, func(r match.Record) bool { return r.MatchKey == created.MatchKey }) {
		t.Fatal("the user's manual match vanished on tour replay — seeding must never wipe")
	}
}

// sandboxApp is a real App over a temp install with a live SQLite store —
// profile switches re-open stores, so the fake cannot stand in here.
func sandboxApp(t *testing.T) *app.App {
	t.Helper()
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	a := app.New()
	a.Startup(context.Background())
	return a
}
