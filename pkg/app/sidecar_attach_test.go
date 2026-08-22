package app_test

import (
	"slices"
	"testing"

	"recall/pkg/aggregate"
	"recall/pkg/app"
	"recall/pkg/db"
	"recall/pkg/match"
	"recall/pkg/parser"
)

// The read side of the per-match sidecars. The WRITES live in
// pkg/matchedit and are tested there against a bare store; what the shell
// still owns is the aggregation that carries each sidecar back out onto a
// match.Record, and these are the tests that a sidecar written through the
// shell survives the round trip.

func TestAttachAnnotations_MergesIntoRecords(t *testing.T) {
	annos := map[string]db.Annotation{
		"k1": {MatchKey: "k1", Leavers: []string{"self"}, Note: "left at 2min"},
		"k3": {MatchKey: "k3", Leavers: []string{"enemy"}},
	}
	recs := []match.Record{
		{MatchKey: "k1"},
		{MatchKey: "k2"}, // no annotation
		{MatchKey: "k3"},
	}
	aggregate.AttachAnnotations(recs, annos)
	if recs[0].Annotation == nil || !slices.Equal(recs[0].Annotation.Leavers, []string{"self"}) {
		t.Errorf("k1 should have self annotation: %+v", recs[0].Annotation)
	}
	if recs[1].Annotation != nil {
		t.Errorf("k2 should have no annotation: %+v", recs[1].Annotation)
	}
	if recs[2].Annotation == nil || !slices.Equal(recs[2].Annotation.Leavers, []string{"enemy"}) {
		t.Errorf("k3 should have enemy annotation: %+v", recs[2].Annotation)
	}
}

// The sides must survive the read path. GetMatchByKey exercises the aggregator's
// annotation attach, which has two call sites that both have to carry them.
func TestGetMatchByKey_CarriesBothSideSets(t *testing.T) {
	fake := &fakeStore{}
	a := app.NewWithStore(fake)
	quick := manualInput("defeat")
	quick.Leavers = []string{"team", "self"}
	rec, err := a.CreateManualMatch(quick)
	if err != nil {
		t.Fatalf("CreateManualMatch: %v", err)
	}
	if err := a.SetMatchAnnotation(app.AnnotationInput{
		MatchKey: rec.MatchKey,
		Leavers:  []string{"team", "self"},
		Throwers: []string{"enemy"},
	}); err != nil {
		t.Fatalf("SetMatchAnnotation: %v", err)
	}
	got, err := a.GetMatchByKey(rec.MatchKey)
	if err != nil {
		t.Fatalf("GetMatchByKey: %v", err)
	}
	if got.Annotation == nil {
		t.Fatal("annotation missing from the aggregated record")
	}
	if len(got.Annotation.Leavers) != 2 {
		t.Errorf("leavers = %v, want 2 sides", got.Annotation.Leavers)
	}
	if len(got.Annotation.Throwers) != 1 || got.Annotation.Throwers[0] != "enemy" {
		t.Errorf("throwers = %v, want [enemy]", got.Annotation.Throwers)
	}
}

func TestAttachReviews_PopulatesReviewedByAndAt(t *testing.T) {
	reviews := map[string]db.ReviewState{
		"k1": {ReviewedBy: "self", ReviewedAt: "2026-06-01T10:00:00Z"},
		"k3": {ReviewedBy: "coach", ReviewedAt: "2026-05-30T08:15:00Z"},
	}
	recs := []match.Record{
		{MatchKey: "k1"},
		{MatchKey: "k2"},
		{MatchKey: "k3"},
	}
	aggregate.AttachReviews(recs, reviews)
	if recs[0].ReviewedBy != "self" || recs[0].ReviewedAt != "2026-06-01T10:00:00Z" {
		t.Errorf("k1: %+v", recs[0])
	}
	if recs[1].ReviewedBy != "" || recs[1].ReviewedAt != "" {
		t.Errorf("k2 should stay unreviewed, got %+v", recs[1])
	}
	if recs[2].ReviewedBy != "coach" || recs[2].ReviewedAt != "2026-05-30T08:15:00Z" {
		t.Errorf("k3: %+v", recs[2])
	}
}

func TestAggregateAll_AttachesReviews(t *testing.T) {
	fs := &fakeStore{}
	a := app.NewWithStore(fs)
	// Seed one summary row + a review tag.
	if err := fs.SetReview("m1", "coach"); err != nil {
		t.Fatalf("seed review: %v", err)
	}
	// Need at least one screenshot row carrying the same key so
	// the aggregator emits a record.
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
	if recs[0].ReviewedBy != "coach" {
		t.Errorf("recs[0].ReviewedBy = %q, want coach", recs[0].ReviewedBy)
	}
}

func TestAttachQueues_PopulatesQueueType(t *testing.T) {
	queues := map[string]db.QueueState{
		"k1": {QueueType: "role", OverriddenAt: "2026-06-01T10:00:00Z"},
		"k3": {QueueType: "open", OverriddenAt: "2026-05-30T08:15:00Z"},
	}
	recs := []match.Record{
		{MatchKey: "k1"},
		{MatchKey: "k2"},
		{MatchKey: "k3"},
	}
	aggregate.AttachQueues(recs, queues)
	if recs[0].QueueType != "role" {
		t.Errorf("k1: %+v", recs[0])
	}
	if recs[1].QueueType != "" {
		t.Errorf("k2 should stay unset, got %+v", recs[1])
	}
	if recs[2].QueueType != "open" {
		t.Errorf("k3: %+v", recs[2])
	}
}

func TestAggregateAll_AttachesQueue(t *testing.T) {
	fs := &fakeStore{}
	a := app.NewWithStore(fs)
	if err := fs.SetMatchQueue("m1", "open"); err != nil {
		t.Fatalf("seed queue: %v", err)
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
	if recs[0].QueueType != "open" {
		t.Errorf("recs[0].QueueType = %q, want open", recs[0].QueueType)
	}
}

func TestAttachPlayModes_UsesOverrideOnly(t *testing.T) {
	// Pure-override semantics: only the aux-table value surfaces.
	// Parser-written data.mode does NOT shadow an absent override.
	overrides := map[string]db.PlayModeState{
		"k1": {PlayMode: "quickplay", OverriddenAt: "2026-06-01T10:00:00Z"},
		"k3": {PlayMode: "competitive", OverriddenAt: "2026-06-02T10:00:00Z"},
	}
	recs := []match.Record{
		{MatchKey: "k1", Data: parser.MatchResult{Playlist: "competitive"}},
		{MatchKey: "k2", Data: parser.MatchResult{Playlist: "competitive"}}, // no override
		{MatchKey: "k3", Data: parser.MatchResult{Playlist: "quickplay"}},
	}
	aggregate.AttachPlayModes(recs, overrides)
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
	recs := []match.Record{{
		MatchKey:    "k1",
		Data:        parser.MatchResult{Playlist: "competitive"},
		SourceTypes: map[string]parser.ScreenshotType{"r.png": "rank"},
	}}
	aggregate.AttachPlayModes(recs, nil)
	if recs[0].PlayMode != "" {
		t.Errorf("no override → must stay empty regardless of rank presence, got %q", recs[0].PlayMode)
	}
}

func TestAttachPlayModes_NoSignalLeavesEmpty(t *testing.T) {
	recs := []match.Record{{
		MatchKey:    "k1",
		Data:        parser.MatchResult{Playlist: ""},
		SourceTypes: map[string]parser.ScreenshotType{"s.png": "summary"},
	}}
	aggregate.AttachPlayModes(recs, nil)
	if recs[0].PlayMode != "" {
		t.Errorf("no signal should leave PlayMode empty, got %q", recs[0].PlayMode)
	}
}

func TestAggregateAll_AttachesPlayMode(t *testing.T) {
	fs := &fakeStore{}
	a := app.NewWithStore(fs)
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
