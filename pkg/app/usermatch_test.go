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

// The shell's half of the user-override surface. Every value rule is pinned at
// the leaf (pkg/matchedit); what these hold is what only the shell can do —
// re-read the key, overlay the override onto the folded OCR rows, and hand back
// an aggregated record with its provenance derived.

// manualInput is the quick-add form at its minimum — the two required fields
// plus a fixed instant, so each test names only what it varies.
func manualInput(result string) match.ManualMatchInput {
	return match.ManualMatchInput{
		Map:      "ilios",
		Result:   result,
		PlayedAt: "2026-06-15T14:30:00Z",
	}
}

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

// The leaf's refusals have to reach the caller as the SAME error values
// pkg/cmd maps to a status code. An alias that drifted into its own
// errors.New would still compile and still refuse — and every one of these
// would silently become a 500 instead of the 4xx the API documents.
func TestUserMatchWrites_SurfaceTheLeafSentinels(t *testing.T) {
	a := app.NewWithStore(dbtest.New())
	bad := "win"
	if err := a.UpdateMatchData("m1", match.UserMatchDataInput{Result: &bad}); !errors.Is(err, app.ErrInvalidResult) {
		t.Errorf("bad result: err = %v, want ErrInvalidResult", err)
	}
	if err := a.UpdateMatchData("", match.UserMatchDataInput{}); !errors.Is(err, app.ErrMatchKeyRequired) {
		t.Errorf("empty key: err = %v, want ErrMatchKeyRequired", err)
	}
	if err := a.ResetMatchData(""); !errors.Is(err, app.ErrMatchKeyRequired) {
		t.Errorf("empty key on reset: err = %v, want ErrMatchKeyRequired", err)
	}
	if _, err := a.CreateManualMatch(match.ManualMatchInput{Result: "victory"}); !errors.Is(err, app.ErrManualNeedsMap) {
		t.Errorf("no map: err = %v, want ErrManualNeedsMap", err)
	}
}

func TestCreateManualMatch_CreatesManualRecord(t *testing.T) {
	fake := dbtest.New()
	a := app.NewWithStore(fake)

	in := manualInput("victory")
	in.PlayMode, in.QueueType = "competitive", "role"
	in.Heroes, in.Leavers = []string{"ana", "kiriko"}, []string{"team"}

	rec, err := a.CreateManualMatch(in)
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

func TestCreateManualMatch_WritesOptionalAnnotationFields(t *testing.T) {
	a := app.NewWithStore(dbtest.New())

	in := manualInput("victory")
	in.PlayMode, in.QueueType = "competitive", "open"
	in.Heroes = []string{"ana"}
	in.ReplayCode, in.Note = "ABC123", "great comeback"
	in.Tags, in.Members = []string{"clutch", "stream"}, []string{"Apollo#11234"}

	rec, err := a.CreateManualMatch(in)
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

// Overwatch drops a match you leave early from your history, so the OCR
// pipeline never sees it. The quick-add records one from the map and the result
// alone — which means manual create can no longer demand a hero, a play mode,
// or a queue type.
func TestCreateManualMatch_QuickEntryNeedsOnlyMapAndResult(t *testing.T) {
	a := app.NewWithStore(dbtest.New())

	in := manualInput("defeat")
	in.Leavers = []string{"team", "self"}

	rec, err := a.CreateManualMatch(in)
	if err != nil {
		t.Fatalf("map + result should be enough, got: %v", err)
	}
	if rec.Data.Map != "ilios" || rec.Data.Result != "defeat" {
		t.Errorf("map/result = %q/%q, want ilios/defeat", rec.Data.Map, rec.Data.Result)
	}
	if rec.Data.Hero != "" {
		t.Errorf("Hero = %q, want empty on a hero-less quick entry", rec.Data.Hero)
	}
	if rec.Source != match.SourceManual {
		t.Errorf("Source = %q, want manual", rec.Source)
	}
	if rec.Annotation == nil || len(rec.Annotation.Leavers) != 2 {
		t.Errorf("annotation leavers = %+v, want both team and self", rec.Annotation)
	}
}

// An omitted mode / queue must not be invented on the way back out — the
// aggregator has no aux row to read, and inventing one would fabricate data.
func TestCreateManualMatch_LeavesModeAndQueueUnsetWhenOmitted(t *testing.T) {
	a := app.NewWithStore(dbtest.New())

	rec, err := a.CreateManualMatch(manualInput("victory"))
	if err != nil {
		t.Fatalf("CreateManualMatch: %v", err)
	}
	if rec.PlayMode != "" {
		t.Errorf("PlayMode = %q, want empty — an omitted mode must not be invented", rec.PlayMode)
	}
	if rec.QueueType != "" {
		t.Errorf("QueueType = %q, want empty", rec.QueueType)
	}
}

// The rank block the create path writes has to survive the overlay and reach
// the record the API returns.
func TestCreateManualMatch_AppliesRankOverride(t *testing.T) {
	a := app.NewWithStore(dbtest.New())

	in := manualInput("victory")
	in.Rank = &match.ManualRankInput{
		Tier: "platinum", Division: 3, Progress: 40, ChangePercent: -12,
		DemotionProtection: true,
	}

	rec, err := a.CreateManualMatch(in)
	mustNoErr(t, err)

	if rec.Data.Rank != "platinum" || rec.Data.Level != 3 {
		t.Errorf("rank/level = %q/%d, want platinum/3", rec.Data.Rank, rec.Data.Level)
	}
	if rec.Data.RankProgress == nil || *rec.Data.RankProgress != 40 ||
		rec.Data.ChangePercent == nil || *rec.Data.ChangePercent != -12 {
		t.Errorf("progress/change = %v/%v, want 40/-12 — nil means the override did not land",
			rec.Data.RankProgress, rec.Data.ChangePercent)
	}
	if !slices.Contains(rec.Data.Modifiers, "demotion protection") {
		t.Errorf("Modifiers = %v, want the demotion-protection marker", rec.Data.Modifiers)
	}
}

// A rank entered without a tier renders as "no rank", not as a blank rank
// pill — the leaf leaves the column NULL and the record must read that way.
func TestCreateManualMatch_OmittedTierRendersAsNoRank(t *testing.T) {
	a := app.NewWithStore(dbtest.New())

	in := manualInput("victory")
	in.Rank = &match.ManualRankInput{Division: 2, Progress: 55, ChangePercent: 9}

	rec, err := a.CreateManualMatch(in)
	mustNoErr(t, err)

	if rec.Data.Rank != "" {
		t.Errorf("Rank = %q, want it left unset when no tier was entered", rec.Data.Rank)
	}
	if rec.Data.RankProgress == nil || *rec.Data.RankProgress != 55 || rec.Data.Level != 2 {
		t.Errorf("progress/level = %v/%d, want 55/2 — the rest of the block still applies",
			rec.Data.RankProgress, rec.Data.Level)
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
