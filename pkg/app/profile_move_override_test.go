package app_test

import (
	"context"
	"testing"

	"recall/pkg/app"
	"recall/pkg/db"
)

// A manual match (or an edited OCR match) lives in the user_match_data override
// layer, not the OCR parent tables — so the move must carry that layer too, or
// the match is deleted from the source and never written to the target.
func TestApp_MoveMatches_TransfersUserOverrideData(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	a := app.New()
	a.Startup(context.Background())
	if err := a.CreateProfile("alt"); err != nil {
		t.Fatalf("CreateProfile: %v", err)
	}
	if err := a.SwitchProfile("main"); err != nil {
		t.Fatalf("SwitchProfile main: %v", err)
	}

	const key = "match-2026-05-10T22-00-00"
	mapName, hero := "rialto", "lucio"
	if err := app.AppStore(a).UpsertUserMatchData(db.UserMatchData{
		MatchKey: key, Map: &mapName, Hero: &hero,
	}); err != nil {
		t.Fatalf("seed user_match_data: %v", err)
	}

	if err := a.MoveMatches([]string{key}, "alt"); err != nil {
		t.Fatalf("MoveMatches: %v", err)
	}

	// Source ("main") lost it.
	if recs, err := a.GetMatchResults(); err != nil || len(recs) != 0 {
		t.Fatalf("source matches = %d (err %v), want 0", len(recs), err)
	}

	// Target ("alt") gained it, override data intact.
	if err := a.SwitchProfile("alt"); err != nil {
		t.Fatalf("SwitchProfile alt: %v", err)
	}
	recs, err := a.GetMatchResults()
	if err != nil {
		t.Fatalf("GetMatchResults: %v", err)
	}
	if len(recs) != 1 || recs[0].MatchKey != key {
		t.Fatalf("target matches = %+v, want 1 with key %s", recs, key)
	}
	if recs[0].Data.Map != "rialto" || recs[0].Data.Hero != "lucio" {
		t.Errorf("target map/hero = %q/%q, want rialto/lucio", recs[0].Data.Map, recs[0].Data.Hero)
	}
}
