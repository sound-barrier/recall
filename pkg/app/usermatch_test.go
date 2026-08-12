package app_test

import (
	"errors"
	"slices"
	"testing"

	"recall/pkg/app"
	"recall/pkg/db"
	"recall/pkg/db/dbtest"
	"recall/pkg/match"
)

func TestUpdateMatchData_OverridesOCRAndMarksEdited(t *testing.T) {
	const key = "match-2026-01-05T21-30-00"
	fake := dbtest.New()
	fake.Summaries = []db.SummaryRow{{Filename: "s.png", MatchKey: key, Map: "rialto", Hero: "lucio"}}
	a := app.NewWithStore(fake)

	newMap := "ilios"
	if err := a.UpdateMatchData(key, match.UserMatchDataInput{Map: &newMap}); err != nil {
		t.Fatalf("UpdateMatchData: %v", err)
	}

	rec, err := a.GetMatchByKey(key)
	if err != nil {
		t.Fatalf("GetMatchByKey: %v", err)
	}
	if rec.Data.Map != "ilios" {
		t.Errorf("Map = %q, want overridden 'ilios'", rec.Data.Map)
	}
	if rec.Source != match.SourceOCREdited {
		t.Errorf("Source = %q, want ocr_edited", rec.Source)
	}
	if !slices.Contains(rec.EditedFields, "data.map") {
		t.Errorf("EditedFields = %v, want data.map", rec.EditedFields)
	}
}

func TestUpdateMatchData_RejectsInvalidResult(t *testing.T) {
	a := app.NewWithStore(dbtest.New())
	bad := "win"
	if err := a.UpdateMatchData("m1", match.UserMatchDataInput{Result: &bad}); !errors.Is(err, app.ErrInvalidResult) {
		t.Errorf("err = %v, want ErrInvalidResult", err)
	}
	if err := a.UpdateMatchData("", match.UserMatchDataInput{}); !errors.Is(err, app.ErrMatchKeyRequired) {
		t.Errorf("empty key: err = %v, want ErrMatchKeyRequired", err)
	}
}

func TestCreateManualMatch_CreatesManualRecord(t *testing.T) {
	fake := dbtest.New()
	a := app.NewWithStore(fake)

	rec, err := a.CreateManualMatch(match.ManualMatchInput{
		Map:       "ilios",
		PlayMode:  "competitive",
		QueueType: "role",
		Heroes:    []string{"ana", "kiriko"},
		Result:    "victory",
		PlayedAt:  "2026-06-15T14:30:00Z",
		Leavers:   []string{"team"},
	})
	if err != nil {
		t.Fatalf("CreateManualMatch: %v", err)
	}

	const wantKey = "match-2026-06-15T14-30-00"
	assertManualIdentity(t, rec, wantKey)
	assertManualSideRows(t, rec, fake, wantKey)
}

// assertManualIdentity pins the created record's key, provenance, and the
// core match fields.
func assertManualIdentity(t *testing.T, rec match.Record, wantKey string) {
	t.Helper()
	if rec.MatchKey != wantKey {
		t.Errorf("MatchKey = %q, want %q", rec.MatchKey, wantKey)
	}
	if rec.Source != match.SourceManual {
		t.Errorf("Source = %q, want manual", rec.Source)
	}
	if rec.Data.Map != "ilios" || rec.Data.Hero != "ana" {
		t.Errorf("map/hero = %q/%q, want ilios/ana (first hero is primary)", rec.Data.Map, rec.Data.Hero)
	}
	if rec.Data.Result != "victory" {
		t.Errorf("Result = %q, want victory", rec.Data.Result)
	}
}

// assertManualSideRows pins the aux rows the create wrote: queue + play-mode
// surface on the record, the override row persisted, and the leaver sides
// ride the annotation surface.
func assertManualSideRows(t *testing.T, rec match.Record, fake *dbtest.Fake, wantKey string) {
	t.Helper()
	if rec.QueueType != "role" || rec.PlayMode != "competitive" {
		t.Errorf("queue/mode = %q/%q, want role/competitive", rec.QueueType, rec.PlayMode)
	}
	if _, ok := fake.UserMatchData[wantKey]; !ok {
		t.Errorf("UserMatchData row not written for %q", wantKey)
	}
	if rec.Annotation == nil || !slices.Equal(rec.Annotation.Leavers, []string{"team"}) {
		t.Errorf("Annotation leaver = %+v, want team", rec.Annotation)
	}
}

// The played_at timestamp's WALL CLOCK (in its stated offset) is what
// drives the match key, date, and finished_at — matching OCR rows,
// which store the player's local wall clock. A UTC conversion here
// would shift a Denver 8pm entry to 02:00 next-day and break any
// time-based filtering.
func TestCreateManualMatch_PreservesLocalWallClock(t *testing.T) {
	fake := dbtest.New()
	a := app.NewWithStore(fake)

	rec, err := a.CreateManualMatch(match.ManualMatchInput{
		Map:       "ilios",
		PlayMode:  "competitive",
		QueueType: "role",
		Heroes:    []string{"ana"},
		Result:    "victory",
		PlayedAt:  "2026-06-15T14:30:00-08:00",
	})
	if err != nil {
		t.Fatalf("CreateManualMatch: %v", err)
	}
	if want := "match-2026-06-15T14-30-00"; rec.MatchKey != want {
		t.Errorf("MatchKey = %q, want %q (wall clock, not UTC)", rec.MatchKey, want)
	}
	if rec.Data.Date != "2026-06-15" {
		t.Errorf("Date = %q, want 2026-06-15", rec.Data.Date)
	}
	if rec.Data.FinishedAt != "14:30" {
		t.Errorf("FinishedAt = %q, want 14:30", rec.Data.FinishedAt)
	}
}

func TestCreateManualMatch_WritesOptionalAnnotationFields(t *testing.T) {
	fake := dbtest.New()
	a := app.NewWithStore(fake)

	rec, err := a.CreateManualMatch(match.ManualMatchInput{
		Map:        "ilios",
		PlayMode:   "competitive",
		QueueType:  "open",
		Heroes:     []string{"ana"},
		Result:     "victory",
		PlayedAt:   "2026-06-15T14:30:00Z",
		ReplayCode: "ABC123",
		Note:       "great comeback",
		Tags:       []string{"clutch", "stream"},
		Members:    []string{"Apollo#11234"},
	})
	if err != nil {
		t.Fatalf("CreateManualMatch: %v", err)
	}
	ann := rec.Annotation
	if ann == nil {
		t.Fatal("Annotation is nil, want replay/note/tags/members written")
	}
	if ann.ReplayCode != "ABC123" {
		t.Errorf("ReplayCode = %q, want ABC123", ann.ReplayCode)
	}
	if ann.Note != "great comeback" {
		t.Errorf("Note = %q, want 'great comeback'", ann.Note)
	}
	if len(ann.Tags) != 2 {
		t.Errorf("Tags = %v, want 2 (clutch, stream)", ann.Tags)
	}
	if len(ann.Members) != 1 || ann.Members[0] != "Apollo#11234" {
		t.Errorf("Members = %v, want [Apollo#11234]", ann.Members)
	}
}

func TestCreateManualMatch_RejectsCollision(t *testing.T) {
	const key = "match-2026-06-15T14-30-00"
	fake := dbtest.New()
	fake.Summaries = []db.SummaryRow{{Filename: "s.png", MatchKey: key}}
	a := app.NewWithStore(fake)

	_, err := a.CreateManualMatch(match.ManualMatchInput{
		Map: "ilios", PlayMode: "competitive", QueueType: "role",
		Heroes: []string{"ana"}, Result: "victory", PlayedAt: "2026-06-15T14:30:00Z",
	})
	if !errors.Is(err, app.ErrMatchKeyExists) {
		t.Errorf("err = %v, want ErrMatchKeyExists", err)
	}
}

func TestCreateManualMatch_Validates(t *testing.T) {
	a := app.NewWithStore(dbtest.New())
	base := match.ManualMatchInput{
		Map: "ilios", PlayMode: "competitive", QueueType: "role",
		Heroes: []string{"ana"}, Result: "victory",
	}
	cases := []struct {
		name string
		mut  func(*match.ManualMatchInput)
		want error
	}{
		{"no map", func(m *match.ManualMatchInput) { m.Map = "" }, app.ErrManualNeedsMap},
		{"bad result", func(m *match.ManualMatchInput) { m.Result = "win" }, app.ErrInvalidResult},
		{"bad leaver", func(m *match.ManualMatchInput) { m.Leavers = []string{"afk"} }, app.ErrInvalidLeaver},
		{"bad play_mode", func(m *match.ManualMatchInput) { m.PlayMode = "ranked" }, app.ErrInvalidPlayMode},
		{"bad queue", func(m *match.ManualMatchInput) { m.QueueType = "5v5" }, app.ErrInvalidQueueType},
		{"rank progress too high", func(m *match.ManualMatchInput) {
			m.Rank = &match.ManualRankInput{Division: 3, Progress: 101}
		}, app.ErrInvalidRank},
		{"rank progress negative", func(m *match.ManualMatchInput) {
			m.Rank = &match.ManualRankInput{Division: 3, Progress: -1}
		}, app.ErrInvalidRank},
		{"division too high", func(m *match.ManualMatchInput) {
			m.Rank = &match.ManualRankInput{Division: 6, Progress: 50}
		}, app.ErrInvalidRank},
		{"change_percent out of range", func(m *match.ManualMatchInput) {
			m.Rank = &match.ManualRankInput{Division: 3, Progress: 50, ChangePercent: 2_000_000}
		}, app.ErrInvalidRank},
		{"unknown map", func(m *match.ManualMatchInput) { m.Map = "notamap" }, app.ErrUnknownMap},
		{"unknown hero", func(m *match.ManualMatchInput) { m.Heroes = []string{"notahero"} }, app.ErrUnknownHero},
		{"unknown rank", func(m *match.ManualMatchInput) {
			m.Rank = &match.ManualRankInput{Tier: "notatier", Division: 3, Progress: 50}
		}, app.ErrUnknownRank},
		// The bug this guard exists for: the form used to submit the display
		// case. It is spec-valid free text, so nothing rejected it, and the
		// match silently fell off every rank chart because the ladder is keyed
		// on the lowercase form.
		{"tier in display case", func(m *match.ManualMatchInput) {
			m.Rank = &match.ManualRankInput{Tier: "Platinum", Division: 3, Progress: 50}
		}, app.ErrUnknownRank},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			in := base
			tc.mut(&in)
			if _, err := a.CreateManualMatch(in); !errors.Is(err, tc.want) {
				t.Errorf("err = %v, want %v", err, tc.want)
			}
		})
	}
}

func TestUpdateMatchData_RejectsOutOfRangeStats(t *testing.T) {
	a := app.NewWithStore(dbtest.New())
	neg, big, overLevel, overPct, bigChange := -1, 1_000_001, 6, 101, 2_000_000
	cases := []struct {
		name string
		in   match.UserMatchDataInput
	}{
		{"negative damage", match.UserMatchDataInput{Damage: &neg}},
		{"damage too big", match.UserMatchDataInput{Damage: &big}},
		{"negative eliminations", match.UserMatchDataInput{Eliminations: &neg}},
		{"level too high", match.UserMatchDataInput{Level: &overLevel}},
		{"rank_progress too high", match.UserMatchDataInput{RankProgress: &overPct}},
		{"change_percent out of range", match.UserMatchDataInput{ChangePercent: &bigChange}},
		{"hero percent too high", match.UserMatchDataInput{Heroes: []match.UserHeroInput{{Hero: "ana", PercentPlayed: &overPct}}}},
		{"hero_stat value negative", match.UserMatchDataInput{HeroStats: []match.UserHeroStatInput{{Hero: "ana", StatKey: "damage", Value: -5}}}},
		{"sr out of range", match.UserMatchDataInput{SR: []match.UserHeroSRInput{{Hero: "ana", SR: -1}}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := a.UpdateMatchData("m1", tc.in); !errors.Is(err, app.ErrStatOutOfRange) {
				t.Errorf("err = %v, want ErrStatOutOfRange", err)
			}
		})
	}
}

func TestUpdateMatchData_RejectsUnknownMapHero(t *testing.T) {
	a := app.NewWithStore(dbtest.New())
	badMap, badHero := "notamap", "notahero"
	if err := a.UpdateMatchData("m1", match.UserMatchDataInput{Map: &badMap}); !errors.Is(err, app.ErrUnknownMap) {
		t.Errorf("unknown map: err = %v, want ErrUnknownMap", err)
	}
	if err := a.UpdateMatchData("m1", match.UserMatchDataInput{Hero: &badHero}); !errors.Is(err, app.ErrUnknownHero) {
		t.Errorf("unknown hero: err = %v, want ErrUnknownHero", err)
	}
	if err := a.UpdateMatchData("m1", match.UserMatchDataInput{Heroes: []match.UserHeroInput{{Hero: badHero}}}); !errors.Is(err, app.ErrUnknownHero) {
		t.Errorf("unknown heroes[]: err = %v, want ErrUnknownHero", err)
	}
}

func TestResetMatchData_ClearsOverride(t *testing.T) {
	const key = "match-1"
	fake := dbtest.New()
	dmg := 50
	fake.UserMatchData = map[string]db.UserMatchData{key: {MatchKey: key, Damage: &dmg}}
	a := app.NewWithStore(fake)

	if err := a.ResetMatchData(key); err != nil {
		t.Fatalf("ResetMatchData: %v", err)
	}
	if _, ok := fake.UserMatchData[key]; ok {
		t.Errorf("override still present after reset")
	}
}
