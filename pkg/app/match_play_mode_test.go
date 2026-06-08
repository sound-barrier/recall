package app

import (
	"errors"
	"testing"

	"recall/pkg/db"
	"recall/pkg/parser"
)

func TestSetMatchPlayMode_PersistsValidValue(t *testing.T) {
	fs := &fakeStore{}
	a := NewWithStore(fs)
	if err := a.SetMatchPlayMode("m1", "competitive"); err != nil {
		t.Fatalf("SetMatchPlayMode competitive: %v", err)
	}
	if err := a.SetMatchPlayMode("m2", "quickplay"); err != nil {
		t.Fatalf("SetMatchPlayMode quickplay: %v", err)
	}
	got, _ := fs.LoadMatchPlayModes()
	if got["m1"].PlayMode != "competitive" || got["m2"].PlayMode != "quickplay" {
		t.Errorf("play_modes map wrong: %+v", got)
	}
}

func TestSetMatchPlayMode_RejectsInvalidValue(t *testing.T) {
	a := NewWithStore(&fakeStore{})
	cases := []string{"", "unranked", "QUICKPLAY", "ranked", "comp"}
	for _, c := range cases {
		err := a.SetMatchPlayMode("m1", c)
		if !errors.Is(err, ErrInvalidPlayMode) {
			t.Errorf("SetMatchPlayMode(%q): err = %v, want ErrInvalidPlayMode", c, err)
		}
	}
}

func TestBulkSetMatchPlayMode_WritesEveryKey(t *testing.T) {
	fs := &fakeStore{}
	a := NewWithStore(fs)
	if err := a.BulkSetMatchPlayMode([]string{"m1", "m2", "m3"}, "competitive"); err != nil {
		t.Fatalf("bulk set: %v", err)
	}
	got, _ := fs.LoadMatchPlayModes()
	for _, k := range []string{"m1", "m2", "m3"} {
		if got[k].PlayMode != "competitive" {
			t.Errorf("after bulk set, %s = %q, want competitive", k, got[k].PlayMode)
		}
	}
}

func TestBulkSetMatchPlayMode_EmptyValueClearsRows(t *testing.T) {
	fs := &fakeStore{}
	a := NewWithStore(fs)
	_ = a.SetMatchPlayMode("m1", "competitive")
	_ = a.SetMatchPlayMode("m2", "quickplay")
	if err := a.BulkSetMatchPlayMode([]string{"m1"}, ""); err != nil {
		t.Fatalf("bulk clear: %v", err)
	}
	got, _ := fs.LoadMatchPlayModes()
	if _, ok := got["m1"]; ok {
		t.Errorf("m1 should have been cleared, got %+v", got["m1"])
	}
	if got["m2"].PlayMode != "quickplay" {
		t.Errorf("m2 not in clear list, should still be quickplay; got %q", got["m2"].PlayMode)
	}
}

func TestBulkSetMatchPlayMode_RejectsInvalidValue(t *testing.T) {
	a := NewWithStore(&fakeStore{})
	err := a.BulkSetMatchPlayMode([]string{"m1"}, "unranked")
	if !errors.Is(err, ErrInvalidPlayMode) {
		t.Errorf("got %v, want ErrInvalidPlayMode", err)
	}
}

func TestSetMatchPlayMode_OverwritesExisting(t *testing.T) {
	fs := &fakeStore{}
	a := NewWithStore(fs)
	if err := a.SetMatchPlayMode("m1", "competitive"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if err := a.SetMatchPlayMode("m1", "quickplay"); err != nil {
		t.Fatalf("overwrite: %v", err)
	}
	got, _ := fs.LoadMatchPlayModes()
	if got["m1"].PlayMode != "quickplay" {
		t.Errorf("after overwrite, m1 = %q, want quickplay", got["m1"].PlayMode)
	}
}

func TestClearMatchPlayMode_IsIdempotent(t *testing.T) {
	fs := &fakeStore{}
	a := NewWithStore(fs)
	if err := a.ClearMatchPlayMode("never-set"); err != nil {
		t.Fatalf("clear on empty: %v", err)
	}
	_ = a.SetMatchPlayMode("m1", "competitive")
	if err := a.ClearMatchPlayMode("m1"); err != nil {
		t.Fatalf("clear: %v", err)
	}
	got, _ := fs.LoadMatchPlayModes()
	if _, ok := got["m1"]; ok {
		t.Errorf("m1 should be cleared, got %+v", got["m1"])
	}
	if err := a.ClearMatchPlayMode("m1"); err != nil {
		t.Fatalf("clear twice: %v", err)
	}
}

func TestSetMatchPlayMode_RequiresMatchKey(t *testing.T) {
	a := NewWithStore(&fakeStore{})
	if err := a.SetMatchPlayMode("", "competitive"); err == nil {
		t.Error("expected error for empty match_key")
	}
	if err := a.ClearMatchPlayMode(""); err == nil {
		t.Error("expected error for empty match_key on clear")
	}
}

func TestAttachPlayModes_UsesOverrideOnly(t *testing.T) {
	// Pure-override semantics: only the aux-table value surfaces.
	// Parser-written data.mode does NOT shadow an absent override.
	overrides := map[string]db.PlayModeState{
		"k1": {PlayMode: "quickplay", SetAt: "2026-06-01T10:00:00Z"},
		"k3": {PlayMode: "competitive", SetAt: "2026-06-02T10:00:00Z"},
	}
	recs := []MatchRecord{
		{MatchKey: "k1", Data: parser.MatchResult{Mode: "competitive"}},
		{MatchKey: "k2", Data: parser.MatchResult{Mode: "competitive"}}, // no override
		{MatchKey: "k3", Data: parser.MatchResult{Mode: "quickplay"}},
	}
	attachPlayModes(recs, overrides)
	if recs[0].PlayMode != "quickplay" {
		t.Errorf("k1: override should win over data.mode, got %q", recs[0].PlayMode)
	}
	if recs[1].PlayMode != "" {
		t.Errorf("k2: no override → must stay empty even with data.mode=competitive, got %q", recs[1].PlayMode)
	}
	if recs[2].PlayMode != "competitive" {
		t.Errorf("k3: override should win, got %q", recs[2].PlayMode)
	}
}

func TestAttachPlayModes_NoFallbackFromRankPresence(t *testing.T) {
	// Pre-fix behavior inferred 'competitive' from rank-row presence,
	// which made the "Not set" UI chip unreachable on any match with
	// a rank screenshot. New behavior: rank presence does NOT
	// surface play_mode unless the user has explicitly set the
	// override.
	recs := []MatchRecord{{
		MatchKey:    "k1",
		Data:        parser.MatchResult{Mode: "competitive"},
		SourceTypes: map[string]string{"r.png": "rank"},
	}}
	attachPlayModes(recs, nil)
	if recs[0].PlayMode != "" {
		t.Errorf("no override → must stay empty regardless of rank presence, got %q", recs[0].PlayMode)
	}
}

func TestAttachPlayModes_NoSignalLeavesEmpty(t *testing.T) {
	recs := []MatchRecord{{
		MatchKey:    "k1",
		Data:        parser.MatchResult{Mode: ""},
		SourceTypes: map[string]string{"s.png": "summary"},
	}}
	attachPlayModes(recs, nil)
	if recs[0].PlayMode != "" {
		t.Errorf("no signal should leave PlayMode empty, got %q", recs[0].PlayMode)
	}
}

func TestAggregateAll_AttachesPlayMode(t *testing.T) {
	fs := &fakeStore{}
	a := NewWithStore(fs)
	if err := fs.SetMatchPlayMode("m1", "quickplay"); err != nil {
		t.Fatalf("seed play_mode: %v", err)
	}
	fs.Summaries = append(fs.Summaries, db.SummaryRow{
		ID: 1, Filename: "s.png", MatchKey: "m1",
		Map: "rialto", Result: "victory",
	})

	recs, err := a.GetMatchResults()
	if err != nil {
		t.Fatalf("GetMatchResults: %v", err)
	}
	if len(recs) != 1 {
		t.Fatalf("len(recs) = %d, want 1", len(recs))
	}
	if recs[0].PlayMode != "quickplay" {
		t.Errorf("recs[0].PlayMode = %q, want quickplay", recs[0].PlayMode)
	}
}
