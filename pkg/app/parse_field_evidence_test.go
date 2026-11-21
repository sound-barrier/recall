package app_test

import (
	"context"
	"errors"
	"image"
	"reflect"
	"sync/atomic"
	"testing"

	"recall/pkg/app"
	"recall/pkg/db"
	"recall/pkg/db/dbtest"
	"recall/pkg/parser"
)

// A parse stores where each reading came from under the screenshot's own
// identity, and a re-parse replaces the record whole: a field it no longer
// reads keeps no region from the earlier parse.
func TestApp_ParseScreenshots_StoresEachScreenshotsFieldEvidence(t *testing.T) {
	a, fake := newParseReadyApp(t)
	dirID, err := fake.EnsureScreenshotsDir(app.SettingsOf(a).ScreenshotsDir)
	if err != nil {
		t.Fatal(err)
	}
	elims := parser.FieldEvidence{
		Field: parser.ScalarPath("eliminations"), Rect: image.Rect(100, 40, 160, 70),
		Template: &parser.TemplateReading{Value: "9", Score: 0.93, Margin: 0.2},
	}
	deaths := parser.FieldEvidence{Field: parser.ScalarPath("deaths"), Rect: image.Rect(300, 40, 340, 70)}
	parseWith := func(evidence ...parser.FieldEvidence) {
		t.Helper()
		stubParse(t, func(progress parser.ProgressFunc) error {
			res := &parser.MatchResult{
				Result: "victory", Map: "rialto", Hero: "lucio",
				ImageSize: image.Pt(1920, 1080), Evidence: evidence,
			}
			progress(1, 1, "shot.png", res, nil)
			return nil
		})
	}

	parseWith(elims, deaths)
	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("ParseScreenshots: %v", err)
	}
	parseWith(elims)
	if err := a.ReParseAll(); err != nil {
		t.Fatalf("ReParseAll: %v", err)
	}

	all, err := fake.LoadFieldEvidence()
	if err != nil {
		t.Fatal(err)
	}
	want := map[db.FileRef]db.ScreenshotEvidence{
		{DirID: dirID, Filename: "shot.png"}: {ImageSize: image.Pt(1920, 1080), Fields: []parser.FieldEvidence{elims}},
	}
	if !reflect.DeepEqual(all, want) {
		t.Errorf("stored evidence = %+v, want %+v", all, want)
	}
}

// evidenceWriteFails refuses every evidence write while failing is set.
type evidenceWriteFails struct {
	*dbtest.Fake
	failing *atomic.Bool
}

func (s evidenceWriteFails) ReplaceFieldEvidence(file db.FileRef, ev db.ScreenshotEvidence) error {
	if s.failing.Load() {
		return errors.New("disk full")
	}
	return s.Fake.ReplaceFieldEvidence(file, ev)
}

// InTransaction hands fn this wrapper, not the Fake inside it, so the
// refusal above still applies inside a transaction.
func (s evidenceWriteFails) InTransaction(fn func(db.Store) error) error {
	return s.Fake.InTransaction(func(db.Store) error { return fn(s) })
}

// stubParseOneHonoringSkip offers filename to the parse loop unless the run
// skips it as already parsed.
func stubParseOneHonoringSkip(t *testing.T, filename string, res *parser.MatchResult) {
	t.Helper()
	prev := app.ParseScreenshotsDirFunc
	app.ParseScreenshotsDirFunc = func(_ context.Context, _ string, skip map[string]bool, progress parser.ProgressFunc) (map[string]*parser.MatchResult, error) {
		if !skip[filename] {
			progress(1, 1, filename, res, nil)
		}
		return nil, nil
	}
	t.Cleanup(func() { app.ParseScreenshotsDirFunc = prev })
}

// A file whose evidence could not be written is reported failed, and a
// failed file is one the next parse reads again. Its row must not land
// without its evidence: a stored row puts the file in the skip set, so the
// record would stay missing until a forced re-parse.
func TestApp_ParseScreenshots_AFileWhoseEvidenceFailedIsParsedAgain(t *testing.T) {
	failing := &atomic.Bool{}
	failing.Store(true)
	store := evidenceWriteFails{Fake: dbtest.New(), failing: failing}
	a := newParseReadyAppOn(t, store)
	dirID, err := store.EnsureScreenshotsDir(app.SettingsOf(a).ScreenshotsDir)
	if err != nil {
		t.Fatal(err)
	}
	want := db.ScreenshotEvidence{ImageSize: image.Pt(1920, 1080), Fields: []parser.FieldEvidence{
		{Field: parser.ScalarPath("deaths"), Rect: image.Rect(300, 40, 340, 70)},
	}}
	stubParseOneHonoringSkip(t, "shot.png", &parser.MatchResult{
		Result: "victory", Map: "rialto", Hero: "lucio", ImageSize: want.ImageSize, Evidence: want.Fields,
	})

	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("first ParseScreenshots: %v", err)
	}
	failing.Store(false)
	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("second ParseScreenshots: %v", err)
	}

	all, err := store.LoadFieldEvidence()
	if err != nil {
		t.Fatal(err)
	}
	if got := all[db.FileRef{DirID: dirID, Filename: "shot.png"}]; !reflect.DeepEqual(got, want) {
		t.Errorf("evidence after the retry = %+v, want %+v — the failed file was never parsed again", got, want)
	}
}
