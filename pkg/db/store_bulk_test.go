package db_test

import (
	"reflect"
	"sort"
	"testing"

	"recall/pkg/db"
)

func TestSQLStore_LookupMatchKeysForFilename_CollectsAndDedupsAcrossTables(t *testing.T) {
	s := openMemory(t)
	mustUpsert := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	// One filename can appear in several parent tables. Two rows share a
	// key (must collapse to one); a third row under the same filename
	// carries a different key (must be kept). filename is UNIQUE *per
	// table*, so the same name across summary/teams/unknown is legal.
	mustUpsert(s.UpsertSummary(db.SummaryRow{Filename: "shot.png", MatchKey: "match-x"}))
	mustUpsert(s.UpsertUnknown(db.UnknownRow{Filename: "shot.png", MatchKey: "match-x"}))
	mustUpsert(s.UpsertTeams(db.TeamsRow{Filename: "shot.png", MatchKey: "match-y"}))
	mustUpsert(s.UpsertSummary(db.SummaryRow{Filename: "other.png", MatchKey: "match-z"}))

	keys, err := s.LookupMatchKeysForFilename("shot.png")
	if err != nil {
		t.Fatalf("LookupMatchKeysForFilename: %v", err)
	}
	sort.Strings(keys)
	if want := []string{"match-x", "match-y"}; !reflect.DeepEqual(keys, want) {
		t.Errorf("got %v, want %v", keys, want)
	}
}

func TestSQLStore_LookupMatchKeysForFilename_AbsentReturnsEmpty(t *testing.T) {
	s := openMemory(t)
	keys, err := s.LookupMatchKeysForFilename("nope.png")
	if err != nil {
		t.Fatalf("LookupMatchKeysForFilename: %v", err)
	}
	if len(keys) != 0 {
		t.Errorf("absent filename: want empty slice, got %v", keys)
	}
}
