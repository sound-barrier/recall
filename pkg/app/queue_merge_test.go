package app

import (
	"testing"

	"recall/pkg/db"
	"recall/pkg/parser"
)

// foldGroup lifts a teams-detected queue type onto the
// top-level MatchRecord.QueueType and clears it from the nested Data,
// so the effective value appears exactly once on the wire.
func TestFoldGroup_LiftsDetectedQueueType(t *testing.T) {
	vs := []screenshotView{{
		filename: "s.png", typeName: "teams", matchKey: "m1",
		parsedAt: "2026-01-01T00:00:00Z",
		data:     parser.MatchResult{Eliminations: 5, QueueType: "open"},
	}}
	rec := foldGroup("m1", vs, nil)
	if rec.QueueType != "open" {
		t.Errorf("rec.QueueType = %q, want %q (detected)", rec.QueueType, "open")
	}
	if rec.Data.QueueType != "" {
		t.Errorf("rec.Data.QueueType = %q, want empty (lifted to top level)", rec.Data.QueueType)
	}
}

// attachQueues is the "manual wins" override: a match_queue annotation
// replaces the detected value; its absence leaves detection intact.
func TestAttachQueues_ManualOverridesDetected(t *testing.T) {
	recs := []MatchRecord{
		{MatchKey: "override-me", QueueType: "open"}, // detected open
		{MatchKey: "leave-me", QueueType: "role"},    // detected role, no annotation
	}
	attachQueues(recs, map[string]db.QueueState{
		"override-me": {QueueType: "role"}, // user says role
	})
	if recs[0].QueueType != "role" {
		t.Errorf("annotated match QueueType = %q, want %q (manual wins)", recs[0].QueueType, "role")
	}
	if recs[1].QueueType != "role" {
		t.Errorf("un-annotated match QueueType = %q, want %q (detection intact)", recs[1].QueueType, "role")
	}
}
