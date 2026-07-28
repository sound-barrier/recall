package app_test

import (
	"errors"
	"testing"

	"recall/pkg/app"
	"recall/pkg/db/dbtest"
	"recall/pkg/match"
)

// Overwatch drops a match you leave early from your history, so the OCR
// pipeline never sees it. The quick-add records one from the map and the result
// alone — which means manual create can no longer demand a hero, a play mode,
// or a queue type.

func manualQuickInput(mapName, result string, leavers []string) match.ManualMatchInput {
	return match.ManualMatchInput{
		Map:      mapName,
		Result:   result,
		Leavers:  leavers,
		PlayedAt: "2026-06-15T14:30:00Z",
	}
}

func TestCreateManualMatch_QuickEntryNeedsOnlyMapAndResult(t *testing.T) {
	fake := dbtest.New()
	a := app.NewWithStore(fake)

	rec, err := a.CreateManualMatch(manualQuickInput("ilios", "defeat", []string{"team", "self"}))
	if err != nil {
		t.Fatalf("map + result should be enough, got: %v", err)
	}
	if rec.Data.Map != "ilios" {
		t.Errorf("Map = %q, want ilios", rec.Data.Map)
	}
	if rec.Data.Result != "defeat" {
		t.Errorf("Result = %q, want defeat", rec.Data.Result)
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

func TestCreateManualMatch_LeavesModeAndQueueUnsetWhenOmitted(t *testing.T) {
	fake := dbtest.New()
	a := app.NewWithStore(fake)

	rec, err := a.CreateManualMatch(manualQuickInput("ilios", "victory", nil))
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

func TestCreateManualMatch_StillValidatesWhatIsSupplied(t *testing.T) {
	a := app.NewWithStore(dbtest.New())
	createErr := func(in match.ManualMatchInput) error {
		_, err := a.CreateManualMatch(in)
		return err
	}

	// Map stays required — it's the one field the quick-add asks for.
	if err := createErr(manualQuickInput("", "defeat", nil)); !errors.Is(err, app.ErrManualNeedsMap) {
		t.Errorf("empty map: err = %v, want ErrManualNeedsMap", err)
	}
	// A supplied-but-bogus mode / queue is still rejected; only omission is OK.
	bad := manualQuickInput("ilios", "defeat", nil)
	bad.PlayMode = "ranked"
	if err := createErr(bad); !errors.Is(err, app.ErrInvalidPlayMode) {
		t.Errorf("bogus play mode: err = %v, want ErrInvalidPlayMode", err)
	}
	bad = manualQuickInput("ilios", "defeat", nil)
	bad.QueueType = "solo"
	if err := createErr(bad); !errors.Is(err, app.ErrInvalidQueueType) {
		t.Errorf("bogus queue type: err = %v, want ErrInvalidQueueType", err)
	}
	// Result is still required — the quick-add's second tap.
	if err := createErr(manualQuickInput("ilios", "", nil)); !errors.Is(err, app.ErrInvalidResult) {
		t.Errorf("empty result: err = %v, want ErrInvalidResult", err)
	}
}
