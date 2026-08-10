package db_test

import (
	"strings"
	"testing"

	"recall/pkg/db"
)

func TestSQLStore_ReAggregateUnknowns_PromotesResolvableRawValues(t *testing.T) {
	s := openMemory(t)
	seedRawOnlyRows(t, s)

	heroFn := func(raw string) string {
		switch {
		case strings.Contains(raw, "cio"):
			return "lucio"
		case strings.Contains(raw, "junk"):
			return "junkrat"
		default:
			return ""
		}
	}
	mapFn := func(raw string) string {
		if strings.Contains(raw, "rial") {
			return "rialto"
		}
		return ""
	}

	n, err := s.ReAggregateUnknowns(heroFn, mapFn)
	mustNoErr(t, err)
	// 2 hero promotions (summary lúcio, personal junkrat) + 1 map (rialto).
	if n != 3 {
		t.Errorf("promoted = %d, want 3", n)
	}

	got, err := s.LoadAll()
	mustNoErr(t, err)
	assertPromotedRows(t, got)
}

// seedRawOnlyRows seeds through the real write path: an empty canonical
// hero/map is stored as ” (NOT NULL DEFAULT ”), with the raw OCR string
// preserved for a later matcher pass. This pins the regression where the
// scan predicate missed normally-parsed rows (they used to be stored as
// SQL NULL).
func seedRawOnlyRows(t *testing.T, s *db.SQLStore) {
	t.Helper()
	mustNoErr(t, s.UpsertSummary(db.SummaryRow{
		Filename: "s.png", MatchKey: "match-a",
		Hero: "", HeroRaw: "lúcio", Map: "", MapRaw: "rial+o",
	}))
	mustNoErr(t, s.UpsertPersonal(db.PersonalRow{
		Filename: "p.png", MatchKey: "match-a",
		Hero: "", HeroRaw: "junkr@t",
	}))
	// A row that still won't resolve (matcher returns "") stays untouched.
	mustNoErr(t, s.UpsertSummary(db.SummaryRow{
		Filename: "s2.png", MatchKey: "match-b",
		Hero: "", HeroRaw: "???", Map: "", MapRaw: "???",
	}))
}

// assertPromotedRows pins the post-promotion state: resolvable raw values
// promoted in place, the unresolvable row untouched.
func assertPromotedRows(t *testing.T, got db.Screenshots) {
	t.Helper()
	sums := map[string]db.SummaryRow{}
	for _, r := range got.Summaries {
		sums[r.Filename] = r
	}
	if sums["s.png"].Hero != "lucio" {
		t.Errorf("summary hero = %q, want lucio", sums["s.png"].Hero)
	}
	if sums["s.png"].Map != "rialto" {
		t.Errorf("summary map = %q, want rialto", sums["s.png"].Map)
	}
	if sums["s2.png"].Hero != "" {
		t.Errorf("unresolvable row was wrongly promoted: hero=%q", sums["s2.png"].Hero)
	}
	if len(got.Personals) != 1 || got.Personals[0].Hero != "junkrat" {
		t.Errorf("personal hero not promoted: %+v", got.Personals)
	}
}

func TestSQLStore_ReAggregateUnknowns_NothingResolvableReturnsZero(t *testing.T) {
	s := openMemory(t)
	if err := s.UpsertSummary(db.SummaryRow{
		Filename: "s.png", MatchKey: "k",
		Hero: "", HeroRaw: "unknowable", Map: "", MapRaw: "unknowable",
	}); err != nil {
		t.Fatal(err)
	}
	n, err := s.ReAggregateUnknowns(
		func(string) string { return "" },
		func(string) string { return "" },
	)
	if err != nil {
		t.Fatalf("ReAggregateUnknowns: %v", err)
	}
	if n != 0 {
		t.Errorf("promoted = %d, want 0", n)
	}
}
