package app_test

import (
	"errors"
	"strings"
	"testing"

	"recall/pkg/app"
	"recall/pkg/db"
	"recall/pkg/db/dbtest"
)

// A coach reviews by WATCHING the replay — a bundle whose matches carry no
// replay code hands them nothing to load. Share mode therefore requires a
// code on every selected match; the ordinary export (a backup) does not,
// and a self-review sitting never needs one (nothing is watched remotely).
func TestExportShareBundle_RequiresAReplayCodeOnEveryMatch(t *testing.T) {
	isolateInstall(t)
	store := dbtest.New()
	mustNoErr(t, playerCorpus(store))
	a := app.NewWithStore(store)

	// Strip ONE match's code — the share refuses and counts the gap.
	mustNoErr(t, store.SetAnnotation(db.Annotation{MatchKey: playerMatchIlios, ReplayCode: ""}))
	_, err := a.ExportShareBundle(playerBundleOpts(), app.SharePlayer{Handle: playerHandle})
	if !errors.Is(err, app.ErrShareNeedsReplayCode) {
		t.Fatalf("share with a code-less match = %v, want ErrShareNeedsReplayCode", err)
	}
	if !strings.Contains(err.Error(), "1 of 3") {
		t.Errorf("refusal %q should count the gap (1 of 3)", err)
	}
	// No receipt for a refused share.
	sent, err := a.ListShareExports()
	mustNoErr(t, err)
	if len(sent) != 0 {
		t.Fatalf("refused share left %d ledger rows, want 0", len(sent))
	}

	// Code restored: the share goes through.
	mustNoErr(t, store.SetAnnotation(db.Annotation{MatchKey: playerMatchIlios, ReplayCode: "EF34GH"}))
	if _, err := a.ExportShareBundle(playerBundleOpts(), app.SharePlayer{Handle: playerHandle}); err != nil {
		t.Fatalf("share with codes on every match = %v, want success", err)
	}
}

// The ordinary export is a backup, not a coaching hand-off — no code needed.
func TestExportBundle_PlainExportNeedsNoReplayCode(t *testing.T) {
	isolateInstall(t)
	store := dbtest.New()
	mustNoErr(t, playerCorpus(store))
	a := app.NewWithStore(store)

	if _, err := a.ExportBundle(playerBundleOpts()); err != nil {
		t.Fatalf("plain export without codes = %v, want success", err)
	}
}
