package db_test

import (
	"sort"
	"testing"

	"recall/pkg/db"
)

// The leaver/thrower sides moved off a single-value column on
// match_annotations onto two set tables, because a match can carry a
// disruption on BOTH teams at once (and "a teammate left, then I left" needs
// two leaver sides on one match). These pin the set semantics and the
// one-shot migration off the legacy column.

func sortedSides(s []string) []string {
	out := append([]string(nil), s...)
	sort.Strings(out)
	return out
}

func TestSQLStore_Annotation_MultiSideRoundTrip(t *testing.T) {
	s := openMemory(t)
	want := db.Annotation{
		MatchKey: "match-k1",
		Leavers:  []string{"team", "self"},
		Throwers: []string{"enemy"},
		Note:     "ally dc'd, I bailed at the 2min mark",
	}
	if err := s.SetAnnotation(want); err != nil {
		t.Fatalf("SetAnnotation: %v", err)
	}
	got, err := s.LoadAnnotations()
	if err != nil {
		t.Fatalf("LoadAnnotations: %v", err)
	}
	a, ok := got["match-k1"]
	if !ok {
		t.Fatal("annotation not present after Set")
	}
	if diff := sortedSides(a.Leavers); len(diff) != 2 || diff[0] != "self" || diff[1] != "team" {
		t.Errorf("leavers = %v, want both self and team", a.Leavers)
	}
	if len(a.Throwers) != 1 || a.Throwers[0] != "enemy" {
		t.Errorf("throwers = %v, want [enemy]", a.Throwers)
	}
	if a.Note != want.Note {
		t.Errorf("note round-trip lost: %q", a.Note)
	}
}

func TestSQLStore_Annotation_ThrowerCheckConstraint(t *testing.T) {
	s := openMemory(t)
	// Belt-and-suspenders DB guard behind the App-layer validator: the side
	// vocabulary is the same three values as leavers.
	if err := s.SetAnnotation(db.Annotation{MatchKey: "k", Throwers: []string{"griefer"}}); err == nil {
		t.Fatal("expected CHECK constraint to reject 'griefer'")
	}
	if err := s.SetAnnotation(db.Annotation{MatchKey: "k", Leavers: []string{"afk"}}); err == nil {
		t.Fatal("expected CHECK constraint to reject 'afk'")
	}
}

func TestSQLStore_Annotation_SidesRewrittenWholesale(t *testing.T) {
	s := openMemory(t)
	if err := s.SetAnnotation(db.Annotation{
		MatchKey: "k", Leavers: []string{"self", "team", "enemy"}, Throwers: []string{"team", "enemy"},
	}); err != nil {
		t.Fatalf("SetAnnotation: %v", err)
	}
	// Re-Set with smaller sets — the old sides must be replaced, not merged.
	if err := s.SetAnnotation(db.Annotation{
		MatchKey: "k", Leavers: []string{"enemy"}, Throwers: nil, Note: "kept",
	}); err != nil {
		t.Fatalf("SetAnnotation rewrite: %v", err)
	}
	got, _ := s.LoadAnnotations()
	if len(got["k"].Leavers) != 1 || got["k"].Leavers[0] != "enemy" {
		t.Errorf("leavers = %v, want [enemy]", got["k"].Leavers)
	}
	if len(got["k"].Throwers) != 0 {
		t.Errorf("throwers = %v, want empty after rewrite", got["k"].Throwers)
	}
}

func TestSQLStore_Annotation_DeleteCascadesSides(t *testing.T) {
	s := openMemory(t)
	if err := s.SetAnnotation(db.Annotation{
		MatchKey: "k", Leavers: []string{"team"}, Throwers: []string{"enemy"},
	}); err != nil {
		t.Fatalf("SetAnnotation: %v", err)
	}
	if err := s.DeleteAnnotation("k"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	for _, table := range []string{"match_annotation_leavers", "match_annotation_throwers"} {
		var n int
		q := `SELECT COUNT(*) FROM ` + table + ` WHERE match_key = ?`
		if err := db.RawDB(s).QueryRow(q, "k").Scan(&n); err != nil {
			t.Fatalf("count %s: %v", table, err)
		}
		if n != 0 {
			t.Errorf("%s: %d rows survived the delete, want 0 (cascade)", table, n)
		}
	}
}
