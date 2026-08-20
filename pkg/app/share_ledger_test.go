package app_test

import (
	"testing"

	"recall/pkg/app"
	"recall/pkg/db/dbtest"
)

// Sharing used to leave no trace: the moment the file was handed over, the
// app had no record that anything was ever sent — the Reviews tab read "No
// coach has looked yet" over a set that was in a coach's inbox. The receipt
// is written by the boundary that KNOWS the share left (the server handler,
// the Wails saver) through RecordShareReceipt; these pin the receipt's own
// semantics. The server wiring is pinned in pkg/cmd's export-bundle tests.
func TestRecordShareReceipt_RecordsTheResolvedIdentity(t *testing.T) {
	isolateInstall(t)
	store := dbtest.New()
	mustNoErr(t, playerCorpus(store))
	a := app.NewWithStore(store)

	// First share persists the handle; the second, sent blank, must record
	// the RESOLVED handle — the same fallback the bundle's manifest used —
	// not the raw empty input.
	a.RecordShareReceipt(app.SharePlayer{Handle: playerHandle, Message: "watch my ults"}, "", playerBundleOpts().MatchKeys)
	a.RecordShareReceipt(app.SharePlayer{Message: "second set"}, "/tmp/share.zip", []string{playerMatchRialto})

	sent, err := a.ListShareExports()
	mustNoErr(t, err)
	if len(sent) != 2 {
		t.Fatalf("ListShareExports returned %d entries, want 2", len(sent))
	}
	newest, oldest := sent[0], sent[1]
	if newest.Handle != playerHandle {
		t.Errorf("blank-input handle resolved to %q, want the persisted %q", newest.Handle, playerHandle)
	}
	if newest.SavedPath != "/tmp/share.zip" {
		t.Errorf("saved path = %q, want the one the saver knew", newest.SavedPath)
	}
	if newest.Message != "second set" {
		t.Errorf("newest first: message = %q, want %q", newest.Message, "second set")
	}
	if oldest.ExportedAt == "" {
		t.Error("exported_at is empty, want a stamp")
	}
	want := playerBundleOpts().MatchKeys
	if len(oldest.MatchKeys) != len(want) || oldest.MatchKeys[0] != want[0] {
		t.Errorf("match keys = %v, want %v in selection order", oldest.MatchKeys, want)
	}
}

// A receipt with no resolvable identity (no handle given, none persisted)
// records nothing — and does not error the share that already happened.
func TestRecordShareReceipt_UnresolvableIdentityLeavesNoRow(t *testing.T) {
	isolateInstall(t)
	store := dbtest.New()
	mustNoErr(t, playerCorpus(store))
	a := app.NewWithStore(store)

	a.RecordShareReceipt(app.SharePlayer{}, "", []string{playerMatchRialto})

	sent, err := a.ListShareExports()
	mustNoErr(t, err)
	if len(sent) != 0 {
		t.Fatalf("ListShareExports returned %d entries, want 0", len(sent))
	}
}
