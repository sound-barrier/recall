package app_test

import (
	"testing"
	"time"

	"recall/pkg/app"
	"recall/pkg/db/dbtest"
	"recall/pkg/match"
	"recall/pkg/parser"
)

// A parsed SUMMARY row gets a canonical played_at_utc derived from its naive
// local date+finished_at via the machine timezone identity, while the naive
// fields are stored verbatim (correlator axis untouched). A summary with no
// date/finished_at stores NULL.
func TestApp_ParseScreenshots_DerivesPlayedAtUTC(t *testing.T) {
	a, fake := newParseReadyApp(t)
	stubParse(t, func(progress parser.ProgressFunc) error {
		res := &parser.MatchResult{
			Result: "victory", Map: "rialto", Hero: "lucio",
			Date: "2026-01-15", FinishedAt: "12:00",
		}
		progress(1, 1, "shot.png", res, nil)
		return nil
	})
	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("ParseScreenshots: %v", err)
	}
	if len(fake.Summaries) != 1 {
		t.Fatalf("want 1 summary, got %d", len(fake.Summaries))
	}
	row := fake.Summaries[0]
	if row.Date != "2026-01-15" || row.FinishedAt != "12:00" {
		t.Errorf("naive fields must be verbatim: date=%q finished=%q", row.Date, row.FinishedAt)
	}
	if row.PlayedAtUTC == nil {
		t.Fatal("PlayedAtUTC should be derived from date+finished_at")
	}
	// The canonical instant equals the tz-identity conversion of the naive
	// wall clock — whatever the host zone is, the two must agree.
	want, ok := match.LocalWallClockToUTC("2026-01-15", "12:00", time.Local)
	if !ok {
		t.Skip("host cannot convert the wall clock")
	}
	if *row.PlayedAtUTC != want.Format(time.RFC3339) {
		t.Errorf("PlayedAtUTC = %q, want %q", *row.PlayedAtUTC, want.Format(time.RFC3339))
	}
}

// A manual match stores its canonical played_at_utc as the exact UTC of the
// offset-bearing wire timestamp (an 8pm −08:00 entry → 04:00Z next day),
// while date/finished_at/key stay the naive local wall clock (per #607).
func TestApp_CreateManualMatch_StoresExactPlayedAtUTC(t *testing.T) {
	fake := dbtest.New()
	a := app.NewWithStore(fake)
	if _, err := a.CreateManualMatch(match.ManualMatchInput{
		Map: "ilios", PlayMode: "competitive", QueueType: "role",
		Heroes: []string{"ana"}, Result: "victory",
		PlayedAt: "2026-06-15T20:00:00-08:00",
	}); err != nil {
		t.Fatalf("CreateManualMatch: %v", err)
	}
	got := fake.UserMatchData["match-2026-06-15T20-00-00"]
	if got.PlayedAtUTC == nil || *got.PlayedAtUTC != "2026-06-16T04:00:00Z" {
		t.Errorf("PlayedAtUTC = %v, want 2026-06-16T04:00:00Z", got.PlayedAtUTC)
	}
	if got.Date == nil || *got.Date != "2026-06-15" || got.FinishedAt == nil || *got.FinishedAt != "20:00" {
		t.Errorf("naive date/finished_at must stay local: date=%v finished=%v", got.Date, got.FinishedAt)
	}
}

func TestApp_ParseScreenshots_NoDateStoresNullPlayedAtUTC(t *testing.T) {
	a, fake := newParseReadyApp(t)
	stubParse(t, func(progress parser.ProgressFunc) error {
		// SUMMARY-classified (has Result) but the date/finished_at OCR failed.
		res := &parser.MatchResult{Result: "victory", Map: "rialto", Hero: "lucio"}
		progress(1, 1, "shot.png", res, nil)
		return nil
	})
	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("ParseScreenshots: %v", err)
	}
	if len(fake.Summaries) != 1 {
		t.Fatalf("want 1 summary row, got %d", len(fake.Summaries))
	}
	if row := fake.Summaries[0]; row.PlayedAtUTC != nil {
		t.Errorf("summary without date must store NULL played_at_utc, got %q", *row.PlayedAtUTC)
	}
}
