package app_test

import (
	"context"
	"testing"

	"recall/pkg/app"
	"recall/pkg/db"
)

// Review state ("I watched this VOD" / "a coach reviewed it") is per-key
// sidecar data like annotations and the hidden flag — a cross-profile move
// must carry it, or the state is silently deleted from the source and never
// written to the target.
func TestApp_MoveMatches_TransfersReviewState(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	a := app.New()
	a.Startup(context.Background())
	mustNoErr(t, a.CreateProfile("alt"))
	mustNoErr(t, a.SwitchProfile("main"))

	const key = "match-2026-05-10T22-00-00"
	mapName := "rialto"
	mustNoErr(t, app.Store(a).UpsertUserMatchData(db.UserMatchData{
		MatchKey: key, Map: &mapName,
	}))
	mustNoErr(t, a.SetMatchReview(key, "coach"))

	mustNoErr(t, a.MoveMatches([]string{key}, "alt"))

	mustNoErr(t, a.SwitchProfile("alt"))
	recs, err := a.GetMatchResults()
	mustNoErr(t, err)
	if len(recs) != 1 || recs[0].MatchKey != key {
		t.Fatalf("target matches = %+v, want 1 with key %s", recs, key)
	}
	if recs[0].ReviewedBy != "coach" {
		t.Errorf("target ReviewedBy = %q, want %q", recs[0].ReviewedBy, "coach")
	}
}
