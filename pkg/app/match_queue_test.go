package app

import (
	"errors"
	"testing"

	"recall/pkg/db"
)

func TestSetMatchQueue_PersistsValidValue(t *testing.T) {
	fs := &fakeStore{}
	a := NewWithStore(fs)
	if err := a.SetMatchQueue("m1", "role"); err != nil {
		t.Fatalf("SetMatchQueue role: %v", err)
	}
	if err := a.SetMatchQueue("m2", "open"); err != nil {
		t.Fatalf("SetMatchQueue open: %v", err)
	}
	got, _ := fs.LoadMatchQueues()
	if got["m1"].QueueType != "role" || got["m2"].QueueType != "open" {
		t.Errorf("queues map wrong: %+v", got)
	}
}

func TestSetMatchQueue_RejectsInvalidValue(t *testing.T) {
	a := NewWithStore(&fakeStore{})
	cases := []string{"", "ranked", "5v5", "ROLE", "role "}
	for _, c := range cases {
		err := a.SetMatchQueue("m1", c)
		if !errors.Is(err, ErrInvalidQueueType) {
			t.Errorf("SetMatchQueue(%q): err = %v, want ErrInvalidQueueType", c, err)
		}
	}
}

func TestSetMatchQueue_OverwritesExisting(t *testing.T) {
	fs := &fakeStore{}
	a := NewWithStore(fs)
	if err := a.SetMatchQueue("m1", "role"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if err := a.SetMatchQueue("m1", "open"); err != nil {
		t.Fatalf("overwrite: %v", err)
	}
	got, _ := fs.LoadMatchQueues()
	if got["m1"].QueueType != "open" {
		t.Errorf("after overwrite, m1 = %q, want open", got["m1"].QueueType)
	}
}

func TestClearMatchQueue_IsIdempotent(t *testing.T) {
	fs := &fakeStore{}
	a := NewWithStore(fs)
	if err := a.ClearMatchQueue("never-set"); err != nil {
		t.Fatalf("clear on empty: %v", err)
	}
	_ = a.SetMatchQueue("m1", "role")
	if err := a.ClearMatchQueue("m1"); err != nil {
		t.Fatalf("clear: %v", err)
	}
	got, _ := fs.LoadMatchQueues()
	if _, ok := got["m1"]; ok {
		t.Errorf("m1 should be cleared, got %+v", got["m1"])
	}
	if err := a.ClearMatchQueue("m1"); err != nil {
		t.Fatalf("clear twice: %v", err)
	}
}

func TestSetMatchQueue_RequiresMatchKey(t *testing.T) {
	a := NewWithStore(&fakeStore{})
	if err := a.SetMatchQueue("", "role"); err == nil {
		t.Error("expected error for empty match_key")
	}
	if err := a.ClearMatchQueue(""); err == nil {
		t.Error("expected error for empty match_key on clear")
	}
}

func TestAttachQueues_PopulatesQueueType(t *testing.T) {
	queues := map[string]db.QueueState{
		"k1": {QueueType: "role", SetAt: "2026-06-01T10:00:00Z"},
		"k3": {QueueType: "open", SetAt: "2026-05-30T08:15:00Z"},
	}
	recs := []MatchRecord{
		{MatchKey: "k1"},
		{MatchKey: "k2"},
		{MatchKey: "k3"},
	}
	attachQueues(recs, queues)
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
	a := NewWithStore(fs)
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
