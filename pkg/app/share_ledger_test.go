package app_test

import (
	"testing"

	"recall/pkg/app"
	"recall/pkg/db/dbtest"
)

// Sharing used to leave no trace: the moment the save dialog closed, the app
// had no record that anything was ever sent — the Reviews tab read "No coach
// has looked yet" over a set that was in a coach's inbox. The ledger is the
// receipt: who it went to, what was said, which matches, when.
func TestExportShareBundle_RecordsTheSentLedger(t *testing.T) {
	isolateInstall(t)
	store := dbtest.New()
	mustNoErr(t, playerCorpus(store))
	a := app.NewWithStore(store)

	_, err := a.ExportShareBundle(playerBundleOpts(), app.SharePlayer{Handle: playerHandle, Message: "watch my ults"})
	mustNoErr(t, err)

	sent, err := a.ListShareExports()
	mustNoErr(t, err)
	if len(sent) != 1 {
		t.Fatalf("ListShareExports returned %d entries, want 1", len(sent))
	}
	got := sent[0]
	if got.Handle != playerHandle {
		t.Errorf("handle = %q, want %q", got.Handle, playerHandle)
	}
	if got.Message != "watch my ults" {
		t.Errorf("message = %q, want the one typed", got.Message)
	}
	if got.ExportedAt == "" {
		t.Error("exported_at is empty, want a stamp")
	}
	want := playerBundleOpts().MatchKeys
	if len(got.MatchKeys) != len(want) {
		t.Fatalf("match keys = %v, want %v", got.MatchKeys, want)
	}
	for i, k := range want {
		if got.MatchKeys[i] != k {
			t.Errorf("match key [%d] = %q, want %q (selection order preserved)", i, got.MatchKeys[i], k)
		}
	}
}

// A refused share — no handle — must not leave a ledger row claiming
// something was sent.
func TestExportShareBundle_RefusedShareLeavesNoLedgerRow(t *testing.T) {
	isolateInstall(t)
	store := dbtest.New()
	mustNoErr(t, playerCorpus(store))
	a := app.NewWithStore(store)

	if _, err := a.ExportShareBundle(playerBundleOpts(), app.SharePlayer{}); err == nil {
		t.Fatal("ExportShareBundle with no handle succeeded, want a refusal")
	}
	sent, err := a.ListShareExports()
	mustNoErr(t, err)
	if len(sent) != 0 {
		t.Fatalf("ListShareExports returned %d entries after a refused share, want 0", len(sent))
	}
}

// Newest first: the strip reads like an inbox, and the answer to "did my
// last share go out?" should be the first row.
func TestListShareExports_NewestFirst(t *testing.T) {
	isolateInstall(t)
	store := dbtest.New()
	mustNoErr(t, playerCorpus(store))
	a := app.NewWithStore(store)

	_, err := a.ExportShareBundle(playerBundleOpts(), app.SharePlayer{Handle: playerHandle, Message: "first"})
	mustNoErr(t, err)
	_, err = a.ExportShareBundle(app.ExportBundleOptions{MatchKeys: []string{playerMatchRialto}}, app.SharePlayer{Handle: playerHandle, Message: "second"})
	mustNoErr(t, err)

	sent, err := a.ListShareExports()
	mustNoErr(t, err)
	if len(sent) != 2 {
		t.Fatalf("ListShareExports returned %d entries, want 2", len(sent))
	}
	if sent[0].Message != "second" {
		t.Errorf("first row message = %q, want the newest (%q)", sent[0].Message, "second")
	}
	if len(sent[0].MatchKeys) != 1 {
		t.Errorf("newest row carries %d keys, want 1", len(sent[0].MatchKeys))
	}
}
