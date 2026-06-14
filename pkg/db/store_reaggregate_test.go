package db_test

import (
	"strings"
	"testing"

	"recall/pkg/db"
)

// seedRawSummary inserts a summary row with hero/map set to the literal
// empty string (not NULL) so it matches ReAggregateUnknowns' scan predicate
// `WHERE hero = ” AND hero_raw != ”`. The Upsert path stores empty values
// as SQL NULL via nullableString, which is a separate concern from the
// re-aggregation SQL exercised here.
func seedRawSummary(t *testing.T, s *db.SQLStore, filename, key, heroRaw, mapRaw string) {
	t.Helper()
	if _, err := db.RawDB(s).Exec(
		`INSERT INTO summary_screenshots (filename, match_key, hero, hero_raw, map, map_raw, screenshots_dir_id)
		 VALUES (?, ?, '', ?, '', ?, ?)`,
		filename, key, heroRaw, mapRaw, db.SentinelScreenshotsDirID,
	); err != nil {
		t.Fatalf("seed summary %s: %v", filename, err)
	}
}

func TestSQLStore_ReAggregateUnknowns_PromotesResolvableRawValues(t *testing.T) {
	s := openMemory(t)
	seedRawSummary(t, s, "s.png", "match-a", "lúcio", "rial+o")
	seedRawSummary(t, s, "s2.png", "match-b", "???", "???") // unresolvable — stays put
	if _, err := db.RawDB(s).Exec(
		`INSERT INTO personal_screenshots (filename, match_key, hero, hero_raw, screenshots_dir_id)
		 VALUES (?, ?, '', ?, ?)`,
		"p.png", "match-a", "junkr@t", db.SentinelScreenshotsDirID,
	); err != nil {
		t.Fatalf("seed personal: %v", err)
	}

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
	if err != nil {
		t.Fatalf("ReAggregateUnknowns: %v", err)
	}
	// 2 hero promotions (summary lúcio, personal junkrat) + 1 map (rialto).
	if n != 3 {
		t.Errorf("promoted = %d, want 3", n)
	}

	got, err := s.LoadAll()
	if err != nil {
		t.Fatalf("LoadAll: %v", err)
	}
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
	seedRawSummary(t, s, "s.png", "k", "unknowable", "unknowable")
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
