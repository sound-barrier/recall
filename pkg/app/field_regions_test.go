package app_test

import (
	"errors"
	"image"
	"testing"

	"recall/pkg/app"
	"recall/pkg/db"
	"recall/pkg/match"
	"recall/pkg/parser"
)

// A match's field regions, through the shell: the stored evidence of the
// match's own screenshots, an empty list for a match with none, and the
// single-match read's 404 for a key that names no match.

func TestGetMatchFieldRegions_ServesTheStoredEvidence(t *testing.T) {
	fs := &fakeStore{}
	seedMisread(fs)
	dirID, err := fs.EnsureScreenshotsDir("/shots")
	if err != nil {
		t.Fatal(err)
	}
	fs.Summaries[0].ScreenshotsDirID = dirID
	file := db.FileRef{DirID: dirID, Filename: fs.Summaries[0].Filename}
	if err := fs.ReplaceFieldEvidence(file, db.ScreenshotEvidence{
		ImageSize: image.Pt(1920, 1080),
		Fields:    []parser.FieldEvidence{{Field: misreadElims, Rect: image.Rect(100, 600, 160, 640)}},
	}); err != nil {
		t.Fatal(err)
	}
	a := app.NewWithStore(fs)

	got, err := a.GetMatchFieldRegions(misreadKey)

	if err != nil {
		t.Fatalf("GetMatchFieldRegions: %v", err)
	}
	want := match.FieldRegion{
		SourceFile: file.Filename, DirID: dirID, Field: misreadElims,
		X: 100, Y: 600, Width: 60, Height: 40, ImageWidth: 1920, ImageHeight: 1080,
	}
	if len(got.Regions) != 1 || got.Regions[0] != want {
		t.Errorf("regions = %+v, want [%+v]", got.Regions, want)
	}
}

func TestGetMatchFieldRegions_AMatchWithNoScreenshotsHasNone(t *testing.T) {
	a := app.NewWithStore(&fakeStore{})
	rec, err := a.CreateManualMatch(match.ManualMatchInput{Map: "rialto", Result: "victory"})
	if err != nil {
		t.Fatalf("CreateManualMatch: %v", err)
	}

	got, err := a.GetMatchFieldRegions(rec.MatchKey)

	if err != nil {
		t.Fatalf("GetMatchFieldRegions(manual): %v", err)
	}
	if got.Regions == nil || len(got.Regions) != 0 {
		t.Errorf("regions = %#v, want an empty non-nil list", got.Regions)
	}
}

// loadCountingStore counts full-corpus reads, the cost a region fetch pays.
type loadCountingStore struct {
	*fakeStore
	loads int
}

func (s *loadCountingStore) LoadAll() (db.Screenshots, error) {
	s.loads++
	return s.fakeStore.LoadAll()
}

// Telling a manual match from an unknown key must not aggregate the whole
// history a second time: the card fetches its regions on every expand.
func TestGetMatchFieldRegions_AManualMatchReadsTheCorpusOnce(t *testing.T) {
	store := &loadCountingStore{fakeStore: &fakeStore{}}
	a := app.NewWithStore(store)
	rec, err := a.CreateManualMatch(match.ManualMatchInput{Map: "rialto", Result: "victory"})
	if err != nil {
		t.Fatalf("CreateManualMatch: %v", err)
	}
	store.loads = 0

	if _, err := a.GetMatchFieldRegions(rec.MatchKey); err != nil {
		t.Fatalf("GetMatchFieldRegions(manual): %v", err)
	}

	if store.loads != 1 {
		t.Errorf("LoadAll ran %d times, want 1", store.loads)
	}
}

func TestGetMatchFieldRegions_UnknownKeyIsNotFound(t *testing.T) {
	fs := &fakeStore{}
	seedMisread(fs)
	a := app.NewWithStore(fs)

	_, err := a.GetMatchFieldRegions("match-2030-01-01T00-00-00")

	if !errors.Is(err, match.ErrMatchNotFound) {
		t.Errorf("err = %v, want ErrMatchNotFound", err)
	}
}
