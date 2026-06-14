package db_test

import "testing"

func TestSQLStore_BulkSetMatchQueue_SetsManyAndEmptyClears(t *testing.T) {
	s := openMemory(t)
	keys := []string{"match-a", "match-b", "match-c"}
	if err := s.BulkSetMatchQueue(keys, "role"); err != nil {
		t.Fatalf("BulkSetMatchQueue: %v", err)
	}
	got, err := s.LoadMatchQueues()
	if err != nil {
		t.Fatalf("LoadMatchQueues: %v", err)
	}
	for _, k := range keys {
		if got[k].QueueType != "role" {
			t.Errorf("%s queue = %q, want role", k, got[k].QueueType)
		}
	}

	// Empty queue type is the bulk-clear path (DELETE).
	if err := s.BulkSetMatchQueue([]string{"match-a", "match-b"}, ""); err != nil {
		t.Fatalf("bulk clear: %v", err)
	}
	got, _ = s.LoadMatchQueues()
	if _, ok := got["match-a"]; ok {
		t.Error("match-a should be cleared")
	}
	if _, ok := got["match-b"]; ok {
		t.Error("match-b should be cleared")
	}
	if got["match-c"].QueueType != "role" {
		t.Error("match-c should survive the partial bulk clear")
	}

	// Empty key set is a no-op.
	if err := s.BulkSetMatchQueue(nil, "role"); err != nil {
		t.Errorf("empty key set should be a no-op, got %v", err)
	}
}

func TestSQLStore_BulkSetMatchPlayMode_SetsManyAndEmptyClears(t *testing.T) {
	s := openMemory(t)
	keys := []string{"match-a", "match-b"}
	if err := s.BulkSetMatchPlayMode(keys, "competitive"); err != nil {
		t.Fatalf("BulkSetMatchPlayMode: %v", err)
	}
	got, err := s.LoadMatchPlayModes()
	if err != nil {
		t.Fatalf("LoadMatchPlayModes: %v", err)
	}
	for _, k := range keys {
		if got[k].PlayMode != "competitive" {
			t.Errorf("%s play mode = %q, want competitive", k, got[k].PlayMode)
		}
	}

	// Empty value clears.
	if err := s.BulkSetMatchPlayMode([]string{"match-a"}, ""); err != nil {
		t.Fatalf("bulk clear: %v", err)
	}
	got, _ = s.LoadMatchPlayModes()
	if _, ok := got["match-a"]; ok {
		t.Error("match-a should be cleared")
	}
	if got["match-b"].PlayMode != "competitive" {
		t.Error("match-b should survive the partial bulk clear")
	}
}
