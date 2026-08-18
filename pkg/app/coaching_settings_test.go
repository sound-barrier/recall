package app_test

import (
	"errors"
	"strings"
	"testing"

	"recall/pkg/app"
	"recall/pkg/bundle"
	"recall/pkg/coach"
	"recall/pkg/db/dbtest"
)

// The two coaching identities in Settings: the name notes are signed with,
// and the id + handle a share-with-a-coach export stamps into the manifest.

func TestCoachingSettings_RoundTripsAndPersists(t *testing.T) {
	isolateInstall(t)
	a := app.NewWithStore(dbtest.New())
	if got := a.GetCoachingSettings().CoachName; got != "" {
		t.Fatalf("fresh install coach_name = %q, want empty", got)
	}
	saved, err := a.SetCoachingSettings("  Ordo  ", "")
	mustNoErr(t, err)
	if saved.CoachName != "Ordo" {
		t.Errorf("saved coach_name = %q, want the trimmed %q", saved.CoachName, "Ordo")
	}
	if got := app.LoadSettings(a).CoachName; got != "Ordo" {
		t.Errorf("coach_name on disk = %q, want Ordo", got)
	}
	cleared, err := a.SetCoachingSettings("", "")
	mustNoErr(t, err)
	if cleared.CoachName != "" {
		t.Errorf("cleared coach_name = %q, want empty", cleared.CoachName)
	}
}

func TestCoachingSettings_RejectsAnOverlongName(t *testing.T) {
	isolateInstall(t)
	a := app.NewWithStore(dbtest.New())
	long := strings.Repeat("x", 65)
	// Both identities answer to the same bound: they end up in the same
	// places — a signed ledger, a bundle manifest — and a 65-rune one would
	// be refused there instead, further from where it was typed.
	for _, tc := range []struct {
		name                    string
		coachName, playerHandle string
	}{
		{"coach name", long, ""},
		{"player handle", "", long},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := a.SetCoachingSettings(tc.coachName, tc.playerHandle); !errors.Is(err, app.ErrCoachNameInvalid) {
				t.Errorf("SetCoachingSettings(65 runes) = %v, want app.ErrCoachNameInvalid", err)
			}
		})
	}
}

// The handle was stored only as a side effect of a share and read back by
// nothing, so the share dialog asked for it again every time — on a value the
// server had all along.
func TestCoachingSettings_RoundTripsThePlayerHandle(t *testing.T) {
	isolateInstall(t)
	a := app.NewWithStore(dbtest.New())

	saved, err := a.SetCoachingSettings("Ordo", "  Sable  ")
	mustNoErr(t, err)
	if saved.PlayerHandle != "Sable" {
		t.Errorf("saved player_handle = %q, want the trimmed %q", saved.PlayerHandle, "Sable")
	}
	if got := a.GetCoachingSettings().PlayerHandle; got != "Sable" {
		t.Errorf("GetCoachingSettings player_handle = %q, want Sable", got)
	}
	if got := app.LoadSettings(a).PlayerHandle; got != "Sable" {
		t.Errorf("player_handle on disk = %q, want Sable", got)
	}
}

// The player id is minted once and never rotated, so the coach's notes
// follow the player through a handle change.
func TestExportShareBundle_MintsThePlayerIDOnce(t *testing.T) {
	isolateInstall(t)
	store := dbtest.New()
	mustNoErr(t, playerCorpus(store))
	a := app.NewWithStore(store)

	first, err := a.ExportShareBundle(playerBundleOpts(), app.SharePlayer{Handle: playerHandle, Message: "hi"})
	mustNoErr(t, err)
	minted := app.LoadSettings(a).PlayerID
	if !coach.IsUUID(minted) {
		t.Fatalf("minted player_id = %q, want a UUID", minted)
	}
	if got := app.LoadSettings(a).PlayerHandle; got != playerHandle {
		t.Errorf("persisted player_handle = %q, want %q", got, playerHandle)
	}

	second, err := a.ExportShareBundle(playerBundleOpts(), app.SharePlayer{Handle: "Sable#2187"})
	mustNoErr(t, err)
	if app.LoadSettings(a).PlayerID != minted {
		t.Errorf("player_id rotated on the second share: %q → %q", minted, app.LoadSettings(a).PlayerID)
	}
	assertManifestPlayer(t, first, minted, playerHandle, "hi")
	assertManifestPlayer(t, second, minted, "Sable#2187", "")
}

func assertManifestPlayer(t *testing.T, payload []byte, wantID, wantHandle, wantMessage string) {
	t.Helper()
	contents, err := bundle.Read(payload)
	mustNoErr(t, err)
	if contents.Manifest.Player == nil {
		t.Fatal("share bundle carries no player identity")
	}
	got := *contents.Manifest.Player
	if got.ID != wantID || got.Handle != wantHandle || got.Message != wantMessage {
		t.Errorf("manifest player = %+v, want {%s %s %s}", got, wantID, wantHandle, wantMessage)
	}
}

// A handle the bundle format cannot carry is refused BEFORE it is
// remembered: shareIdentity persists what it resolves, so a handle that
// only the packer rejects would be reused by every later share — including
// the ones that pass no handle at all — and none of them could ever export.
func TestExportShareBundle_DoesNotRememberAnUnusableHandle(t *testing.T) {
	isolateInstall(t)
	store := dbtest.New()
	mustNoErr(t, playerCorpus(store))
	a := app.NewWithStore(store)

	_, err := a.ExportShareBundle(playerBundleOpts(), app.SharePlayer{Handle: strings.Repeat("x", 65)})
	if !errors.Is(err, bundle.ErrPlayerIdentityInvalid) {
		t.Fatalf("share with a 65-rune handle = %v, want bundle.ErrPlayerIdentityInvalid", err)
	}
	if got := app.LoadSettings(a).PlayerHandle; got != "" {
		t.Errorf("a refused share remembered the handle %q", got)
	}
}

// A share with no handle at all — and none remembered — is refused rather
// than shipping an unattributable bundle.
func TestExportShareBundle_NeedsAHandle(t *testing.T) {
	isolateInstall(t)
	store := dbtest.New()
	mustNoErr(t, playerCorpus(store))
	a := app.NewWithStore(store)
	if _, err := a.ExportShareBundle(playerBundleOpts(), app.SharePlayer{}); !errors.Is(err, bundle.ErrPlayerIdentityInvalid) {
		t.Errorf("share with no handle = %v, want bundle.ErrPlayerIdentityInvalid", err)
	}
}

// The ordinary export is never share mode, even if a caller tries: the
// identity is minted here, not accepted from a request body.
func TestExportBundle_NeverCarriesAPlayerIdentity(t *testing.T) {
	isolateInstall(t)
	store := dbtest.New()
	mustNoErr(t, playerCorpus(store))
	a := app.NewWithStore(store)

	opts := playerBundleOpts()
	opts.Player = &bundle.PlayerIdentity{ID: coach.NewID(), Handle: "someone else"}
	payload, err := a.ExportBundle(opts)
	mustNoErr(t, err)
	contents, err := bundle.Read(payload)
	mustNoErr(t, err)
	if contents.Manifest.Player != nil {
		t.Errorf("ExportBundle stamped an identity: %+v", contents.Manifest.Player)
	}
}
