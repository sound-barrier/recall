package profiles_test

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"recall/pkg/profiles"
)

// Recovery + failure behavior of the on-disk profile manager. The happy-path
// CRUD contracts are covered through the app shell's alias; what's pinned here
// is what happens when profiles.json is hand-edited, truncated, or the install
// root can't be written — the states where a wrong choice either strands the
// user's data or boots them into the wrong profile.

// writeMeta writes a raw profiles.json under base and returns base.
func writeMeta(t *testing.T, base, body string) string {
	t.Helper()
	mustNoErr(t, os.MkdirAll(base, 0o700))
	mustNoErr(t, os.WriteFile(filepath.Join(base, "profiles.json"), []byte(body), 0o600))
	return base
}

// A hand-edited profiles.json whose active_profile isn't in the list must not
// strand the install: the manager falls back to a real profile rather than
// booting against a directory that doesn't exist.
func TestLoadProfiles_RepairsActiveProfileNotInList(t *testing.T) {
	cases := []struct {
		name       string
		body       string
		wantActive string
		wantList   []string
	}{
		{
			name:       "falls back to the first listed profile",
			body:       `{"active_profile":"ghost","profiles":["zulu","alpha"]}`,
			wantActive: "alpha", // list is sorted before the fallback picks [0]
			wantList:   []string{"alpha", "zulu"},
		},
		{
			name:       "empty list is repopulated with the default profile",
			body:       `{"active_profile":"ghost","profiles":[]}`,
			wantActive: profiles.DefaultProfileName,
			wantList:   []string{profiles.DefaultProfileName},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			base := writeMeta(t, t.TempDir(), tc.body)
			p, err := profiles.LoadProfiles(base)
			mustNoErr(t, err)
			if p.Active() != tc.wantActive {
				t.Errorf("Active() = %q, want %q", p.Active(), tc.wantActive)
			}
			if got := p.List(); !slices.Equal(got, tc.wantList) {
				t.Errorf("List() = %v, want %v", got, tc.wantList)
			}
			// The repaired active profile's directory has to exist, or every
			// downstream path (settings.json, db/recall.db) opens into nothing.
			if _, statErr := os.Stat(p.ActiveDir()); statErr != nil {
				t.Errorf("active profile dir not created: %v", statErr)
			}
		})
	}
}

// A corrupt profiles.json is an error, never a silent reset — resetting would
// re-init a "fresh" install on top of profile directories that still hold the
// user's databases, and the UI would show an empty history.
func TestLoadProfiles_CorruptMetadataIsAnErrorNotAReset(t *testing.T) {
	base := writeMeta(t, t.TempDir(), `{"active_profile":"main","profiles":[`)
	p, err := profiles.LoadProfiles(base)
	if err == nil {
		t.Fatalf("LoadProfiles accepted truncated JSON, returned %+v", p)
	}
	if p != nil {
		t.Errorf("LoadProfiles returned a usable manager alongside the error: %+v", p)
	}
	var syntaxErr *json.SyntaxError
	if !errors.As(err, &syntaxErr) {
		t.Errorf("error %v does not wrap the JSON failure — the cause is unrecoverable from the message", err)
	}
}

// The immutable list is a sidecar; a name in it that isn't a real profile must
// not make anything read-only. Otherwise a stale entry left over from a rename
// or a hand edit would lock a later profile that happened to reuse the name.
func TestLoadProfiles_IgnoresImmutableNamesOutsideTheProfileList(t *testing.T) {
	base := writeMeta(t, t.TempDir(),
		`{"active_profile":"main","profiles":["main"],"immutable":["main","ghost"]}`)
	p, err := profiles.LoadProfiles(base)
	mustNoErr(t, err)
	if !p.IsImmutable("main") {
		t.Error("a listed immutable profile lost its read-only flag")
	}
	if p.IsImmutable("ghost") {
		t.Error("an unlisted name was honored as immutable")
	}
	// Re-creating that name yields a normal, writable profile.
	mustNoErr(t, p.Create("ghost"))
	if p.IsImmutable("ghost") {
		t.Error("newly created profile inherited a stale immutable entry")
	}
}

// The install root is not writable (a file sits where the directory belongs).
// Startup captures this as a fatal, so the message has to name the stage.
func TestLoadProfiles_UnusableBaseDirIsReported(t *testing.T) {
	base := filepath.Join(t.TempDir(), "recall")
	mustNoErr(t, os.WriteFile(base, []byte("not a directory"), 0o600))

	_, err := profiles.LoadProfiles(base)
	if err == nil {
		t.Fatal("LoadProfiles succeeded with a regular file as the install root")
	}
	assertErrorContains(t, err, "profiles: ensure base dir")
}

// Create must fail loudly when the profile directory can't be made — silently
// adding the name to profiles.json would leave a listed profile whose DB can
// never be opened.
func TestProfiles_Create_ReportsUndoableDirectoryFailure(t *testing.T) {
	base := t.TempDir()
	p, err := profiles.LoadProfiles(base)
	mustNoErr(t, err)
	// Occupy <base>/profiles/alt with a regular file.
	mustNoErr(t, os.WriteFile(filepath.Join(base, "profiles", "alt"), []byte("x"), 0o600))

	err = p.Create("alt")
	if err == nil {
		t.Fatal("Create succeeded with a file occupying the profile directory")
	}
	assertErrorContains(t, err, `profiles: ensure "alt" dir`)
	if slices.Contains(p.List(), "alt") {
		t.Errorf("failed Create still added %q to the list: %v", "alt", p.List())
	}
}

// Delete removes the directory tree, not just the list entry — a leftover tree
// would resurrect the old database if the name were reused.
func TestProfiles_Delete_RemovesTheDirectoryTree(t *testing.T) {
	base := t.TempDir()
	p, err := profiles.LoadProfiles(base)
	mustNoErr(t, err)
	mustNoErr(t, p.Create("alt"))
	dir := p.ProfileDir("alt")
	mustNoErr(t, os.WriteFile(filepath.Join(dir, "settings.json"), []byte("{}"), 0o600))

	mustNoErr(t, p.Delete("alt"))

	if _, statErr := os.Stat(dir); !os.IsNotExist(statErr) {
		t.Errorf("profile dir survived Delete (stat err = %v)", statErr)
	}
	reloaded, err := profiles.LoadProfiles(base)
	mustNoErr(t, err)
	if slices.Contains(reloaded.List(), "alt") {
		t.Errorf("deleted profile came back after reload: %v", reloaded.List())
	}
}

func assertErrorContains(t *testing.T, err error, want string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected an error containing %q, got nil", want)
	}
	if got := err.Error(); !strings.Contains(got, want) {
		t.Errorf("error = %q, want it to contain %q", got, want)
	}
}
