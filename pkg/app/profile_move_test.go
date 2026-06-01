package app

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"recall/pkg/db"
)

// MoveMatches cross-profile transfer. Builds two real SQLStores
// under temp dirs (one per profile) and exercises the full
// read → upsert-target → delete-source sequence.

// movesContext bootstraps an App on a HOME-isolated temp dir,
// creates an "alt" profile alongside the default "main", and
// returns the App. Both profile dirs exist on disk so the move
// can open the target.
func moveCtx(t *testing.T) *App {
	t.Helper()
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	a := New()
	a.Startup(context.Background())
	if err := a.CreateProfile("alt"); err != nil {
		t.Fatalf("CreateProfile alt: %v", err)
	}
	// CreateProfile activates alt; switch back to main so the source
	// is main and the target is alt.
	if err := a.SwitchProfile("main"); err != nil {
		t.Fatalf("SwitchProfile main: %v", err)
	}
	return a
}

func TestApp_MoveMatches_TransfersRowsAndChildren(t *testing.T) {
	a := moveCtx(t)

	// Seed two matches in main with full coverage: a summary +
	// scoreboard + child rows + an annotation + a hidden flag.
	const movedKey = "match:2026-05-10T22:00:00"
	const stayedKey = "match:2026-05-10T23:00:00"

	if err := a.store.UpsertSummary(db.SummaryRow{
		Filename: "moved-summary.png", MatchKey: movedKey,
		Map: "rialto", Mode: "competitive", Hero: "lucio",
		HeroesPlayed: []db.SummaryHeroPlayed{{Hero: "lucio", PercentPlayed: 100}},
	}); err != nil {
		t.Fatalf("seed summary: %v", err)
	}
	if err := a.store.UpsertScoreboard(db.ScoreboardRow{
		Filename: "moved-scoreboard.png", MatchKey: movedKey,
		Mode: "competitive", Eliminations: 17,
		HeroStats: []db.HeroStat{{Hero: "lucio", StatKey: "deaths", StatValue: 11}},
	}); err != nil {
		t.Fatalf("seed scoreboard: %v", err)
	}
	if err := a.store.UpsertSummary(db.SummaryRow{
		Filename: "stayed-summary.png", MatchKey: stayedKey,
		Map: "ilios", Mode: "competitive", Hero: "ana",
	}); err != nil {
		t.Fatalf("seed stayed summary: %v", err)
	}
	if err := a.SetMatchAnnotation(AnnotationInput{MatchKey: movedKey, Note: "smurfs"}); err != nil {
		t.Fatalf("seed annotation: %v", err)
	}
	if err := a.HideMatch(movedKey); err != nil {
		t.Fatalf("seed hidden: %v", err)
	}

	// Move.
	if err := a.MoveMatches([]string{movedKey}, "alt"); err != nil {
		t.Fatalf("MoveMatches: %v", err)
	}

	// Source: movedKey rows are gone, stayedKey rows survive.
	srcData, err := a.store.LoadAll()
	if err != nil {
		t.Fatalf("source LoadAll: %v", err)
	}
	for _, r := range srcData.Summaries {
		if r.MatchKey == movedKey {
			t.Errorf("source still has summary for moved key: %q", r.Filename)
		}
	}
	if !hasSummaryKey(srcData.Summaries, stayedKey) {
		t.Errorf("source lost the stayed summary")
	}
	srcAnns, _ := a.store.LoadAnnotations()
	if _, ok := srcAnns[movedKey]; ok {
		t.Errorf("source annotation survived the move")
	}
	srcHidden, _ := a.store.LoadHiddenKeys()
	if srcHidden[movedKey] {
		t.Errorf("source hidden flag survived the move")
	}

	// Target: the moved rows arrived (open the alt's DB directly).
	altDBPath := filepath.Join(a.profiles.ProfileDir("alt"), "db", "recall.db")
	altStore, err := db.NewSQLStore(altDBPath)
	if err != nil {
		t.Fatalf("open alt store: %v", err)
	}
	defer func() { _ = altStore.Close() }()

	tgtData, err := altStore.LoadAll()
	if err != nil {
		t.Fatalf("target LoadAll: %v", err)
	}
	if !hasSummaryKey(tgtData.Summaries, movedKey) {
		t.Errorf("target missing the moved summary")
	}
	if !hasScoreboardKey(tgtData.Scoreboards, movedKey) {
		t.Errorf("target missing the moved scoreboard")
	}
	if hasSummaryKey(tgtData.Summaries, stayedKey) {
		t.Errorf("target picked up rows that weren't asked to move")
	}
	tgtAnns, _ := altStore.LoadAnnotations()
	if ann, ok := tgtAnns[movedKey]; !ok || ann.Note != "smurfs" {
		t.Errorf("target annotation missing or wrong: %+v", tgtAnns[movedKey])
	}
	tgtHidden, _ := altStore.LoadHiddenKeys()
	if !tgtHidden[movedKey] {
		t.Errorf("target missing the hidden flag")
	}
}

func TestApp_MoveMatches_RemapsScreenshotsDirIDOnTarget(t *testing.T) {
	a := moveCtx(t)

	// The source's screenshots_dirs id space is independent of the
	// target's. Set a screenshots dir on source so the seeded
	// summary references a real screenshots_dir_id, then move and
	// verify the target re-resolved that id.
	srcShotsDir := t.TempDir()
	if err := a.SetScreenshotsDir(srcShotsDir); err != nil {
		t.Fatalf("SetScreenshotsDir: %v", err)
	}
	dirID, err := a.store.EnsureScreenshotsDir(srcShotsDir)
	if err != nil {
		t.Fatalf("EnsureScreenshotsDir: %v", err)
	}

	const key = "match:2026-05-10T22:00:00"
	if err := a.store.UpsertSummary(db.SummaryRow{
		Filename: "with-dir.png", MatchKey: key, ScreenshotsDirID: dirID,
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}

	if err := a.MoveMatches([]string{key}, "alt"); err != nil {
		t.Fatalf("MoveMatches: %v", err)
	}

	altStore, err := db.NewSQLStore(filepath.Join(a.profiles.ProfileDir("alt"), "db", "recall.db"))
	if err != nil {
		t.Fatalf("open alt: %v", err)
	}
	defer func() { _ = altStore.Close() }()
	tgtData, _ := altStore.LoadAll()
	if len(tgtData.Summaries) != 1 {
		t.Fatalf("target should have 1 summary, got %d", len(tgtData.Summaries))
	}
	tgtRow := tgtData.Summaries[0]
	if tgtRow.ScreenshotsDirID == 0 {
		t.Errorf("target row should have a non-zero screenshots_dir_id (path was %q)", srcShotsDir)
	}
	// The path resolves identically — that's the contract.
	if got := tgtData.ScreenshotsDirs[tgtRow.ScreenshotsDirID]; got != srcShotsDir {
		t.Errorf("target screenshots_dir path = %q, want %q", got, srcShotsDir)
	}
}

func TestApp_MoveMatches_RejectsActiveTarget(t *testing.T) {
	a := moveCtx(t)
	err := a.MoveMatches([]string{"any"}, "main")
	if !errors.Is(err, ErrMoveTargetIsActive) {
		t.Errorf("expected ErrMoveTargetIsActive, got %v", err)
	}
}

func TestApp_MoveMatches_RejectsUnknownTarget(t *testing.T) {
	a := moveCtx(t)
	err := a.MoveMatches([]string{"any"}, "nope")
	if !errors.Is(err, ErrProfileNotFound) {
		t.Errorf("expected ErrProfileNotFound, got %v", err)
	}
}

func TestApp_MoveMatches_EmptyKeysIsNoOp(t *testing.T) {
	a := moveCtx(t)
	if err := a.MoveMatches(nil, "alt"); err != nil {
		t.Errorf("empty move should be no-op, got %v", err)
	}
}

func hasSummaryKey(rows []db.SummaryRow, key string) bool {
	for _, r := range rows {
		if r.MatchKey == key {
			return true
		}
	}
	return false
}

func hasScoreboardKey(rows []db.ScoreboardRow, key string) bool {
	for _, r := range rows {
		if r.MatchKey == key {
			return true
		}
	}
	return false
}
