package db_test

import (
	"testing"

	"recall/pkg/db"
)

// played_at_utc round-trips as the additive canonical column alongside the
// naive date/finished_at, on both the OCR summary table and the manual
// override table. nil (no derivable instant) round-trips as SQL NULL.
func TestSQLStore_SummaryPlayedAtUTC_RoundTrip(t *testing.T) {
	s := openMemory(t)
	utc := "2026-01-15T19:00:00Z"
	if err := s.UpsertSummary(db.SummaryRow{
		Filename: "a.png", MatchKey: "match-2026-01-15T12-00-00",
		Date: "2026-01-15", FinishedAt: "12:00", PlayedAtUTC: &utc,
	}); err != nil {
		t.Fatalf("upsert with utc: %v", err)
	}
	if err := s.UpsertSummary(db.SummaryRow{
		Filename: "b.png", MatchKey: "match-x", // no date/finished_at → NULL utc
	}); err != nil {
		t.Fatalf("upsert without utc: %v", err)
	}

	snap, err := s.LoadAll()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	byFile := map[string]db.SummaryRow{}
	for _, r := range snap.Summaries {
		byFile[r.Filename] = r
	}
	a, b := byFile["a.png"], byFile["b.png"]
	if a.PlayedAtUTC == nil || *a.PlayedAtUTC != utc {
		t.Errorf("a.png PlayedAtUTC = %v, want %q", a.PlayedAtUTC, utc)
	}
	if a.Date != "2026-01-15" || a.FinishedAt != "12:00" {
		t.Errorf("naive date/finished_at must be preserved: %+v", a)
	}
	if b.PlayedAtUTC != nil {
		t.Errorf("b.png PlayedAtUTC = %v, want nil (NULL)", *b.PlayedAtUTC)
	}
}

func TestSQLStore_UserMatchPlayedAtUTC_RoundTrip(t *testing.T) {
	s := openMemory(t)
	utc := "2026-06-15T02:00:00Z"
	if err := s.UpsertUserMatchData(db.UserMatchData{
		MatchKey: "match-2026-06-14T20-00-00", PlayedAtUTC: &utc,
	}); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	all, err := s.LoadAllUserMatchData()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	got := all["match-2026-06-14T20-00-00"]
	if got.PlayedAtUTC == nil || *got.PlayedAtUTC != utc {
		t.Errorf("PlayedAtUTC = %v, want %q", got.PlayedAtUTC, utc)
	}
}
