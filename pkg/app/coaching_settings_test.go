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
	saved, err := a.SetCoachingSettings("  Ordo  ")
	mustNoErr(t, err)
	if saved.CoachName != "Ordo" {
		t.Errorf("saved coach_name = %q, want the trimmed %q", saved.CoachName, "Ordo")
	}
	if got := app.LoadSettings(a).CoachName; got != "Ordo" {
		t.Errorf("coach_name on disk = %q, want Ordo", got)
	}
	cleared, err := a.SetCoachingSettings("")
	mustNoErr(t, err)
	if cleared.CoachName != "" {
		t.Errorf("cleared coach_name = %q, want empty", cleared.CoachName)
	}
}

func TestCoachingSettings_RejectsAnOverlongName(t *testing.T) {
	isolateInstall(t)
	a := app.NewWithStore(dbtest.New())
	if _, err := a.SetCoachingSettings(strings.Repeat("x", 65)); !errors.Is(err, app.ErrCoachNameInvalid) {
		t.Errorf("SetCoachingSettings(65 runes) = %v, want app.ErrCoachNameInvalid", err)
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
