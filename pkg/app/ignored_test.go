package app

import (
	"errors"
	"reflect"
	"testing"

	"recall/pkg/db"
)

func TestIgnoreScreenshot_RejectsEmptyFilename(t *testing.T) {
	a := NewWithStore(&fakeStore{})
	if err := a.IgnoreScreenshot(""); !errors.Is(err, ErrIgnoreFilenameRequired) {
		t.Errorf("got err=%v, want ErrIgnoreFilenameRequired", err)
	}
}

func TestIgnoreScreenshot_AddsToSetAndWipesBothKeyShapes(t *testing.T) {
	// Seed an unmatched- row AND an ambiguous- row pointing at the
	// same filename. IgnoreScreenshot must wipe both via
	// HardDeleteMatch so the Unknown card disappears immediately.
	fs := &fakeStore{
		Scoreboards: []db.ScoreboardRow{
			{Filename: "sb.png", MatchKey: "unmatched-sb.png"},
			{Filename: "sb2.png", MatchKey: "ambiguous-sb.png"},
		},
	}
	a := NewWithStore(fs)

	if err := a.IgnoreScreenshot("sb.png"); err != nil {
		t.Fatalf("IgnoreScreenshot: %v", err)
	}

	// Filename is now in the suppress-list.
	got, _ := fs.LoadIgnoredFilenames()
	if !got["sb.png"] {
		t.Errorf("filename not added to ignore set; got=%v", got)
	}

	// Both candidate keys went through HardDeleteMatch.
	wantCalls := []string{"unmatched-sb.png", "ambiguous-sb.png"}
	if !reflect.DeepEqual(fs.HardDeleteCalls, wantCalls) {
		t.Errorf("HardDeleteCalls = %v, want %v", fs.HardDeleteCalls, wantCalls)
	}
}

func TestIgnoreScreenshot_IsIdempotent(t *testing.T) {
	fs := &fakeStore{}
	a := NewWithStore(fs)
	if err := a.IgnoreScreenshot("dup.png"); err != nil {
		t.Fatalf("first ignore: %v", err)
	}
	if err := a.IgnoreScreenshot("dup.png"); err != nil {
		t.Fatalf("second ignore: %v", err)
	}
	got, _ := fs.LoadIgnoredFilenames()
	if !got["dup.png"] {
		t.Errorf("filename absent after duplicate ignores; got=%v", got)
	}
}

func TestUnignoreScreenshot_RemovesFromSet(t *testing.T) {
	fs := &fakeStore{}
	a := NewWithStore(fs)
	if err := a.IgnoreScreenshot("toggle.png"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if err := a.UnignoreScreenshot("toggle.png"); err != nil {
		t.Fatalf("unignore: %v", err)
	}
	got, _ := fs.LoadIgnoredFilenames()
	if got["toggle.png"] {
		t.Errorf("filename still present after unignore; got=%v", got)
	}
}

func TestGetIgnoredScreenshots_ReturnsSorted(t *testing.T) {
	fs := &fakeStore{}
	a := NewWithStore(fs)
	for _, f := range []string{"zoo.png", "alpha.png", "middle.png"} {
		_ = a.IgnoreScreenshot(f)
	}
	out, err := a.GetIgnoredScreenshots()
	if err != nil {
		t.Fatalf("GetIgnoredScreenshots: %v", err)
	}
	want := []string{"alpha.png", "middle.png", "zoo.png"}
	if !reflect.DeepEqual(out, want) {
		t.Errorf("GetIgnoredScreenshots = %v, want %v", out, want)
	}
}
