package profiles_test

import (
	"image"
	"reflect"
	"testing"

	"recall/pkg/db"
	"recall/pkg/parser"
	"recall/pkg/profiles"
)

// Field evidence is what lets a reading be shown beside the pixels it came
// from. Move's phase 2 hard-deletes the source, so evidence the copy leaves
// behind is gone, and the moved match's readings point at nothing until a
// re-parse on the target. It lands under the TARGET's folder id: ids are per
// profile, only the path is shared.
func TestMove_CarriesEachMovedScreenshotsFieldEvidence(t *testing.T) {
	src, dst := newStore(t, "src"), newStore(t, "dst")
	const dir = "/shots/a"
	if _, err := dst.EnsureScreenshotsDir("/shots/unrelated"); err != nil {
		t.Fatalf("seed target dir: %v", err)
	}
	seedSummaryInDir(t, src, movedKey, dir)
	seedSummaryInDir(t, src, stayedKey, dir)
	srcDir, err := src.EnsureScreenshotsDir(dir)
	mustNoErr(t, err)
	evidence := db.ScreenshotEvidence{ImageSize: image.Pt(1920, 1080), Fields: []parser.FieldEvidence{{
		Field: parser.ScalarPath("eliminations"), Rect: image.Rect(100, 40, 160, 70),
		Template: &parser.TemplateReading{Value: "9", Score: 0.93, Margin: 0.2},
	}}}
	movedFile := db.FileRef{DirID: srcDir, Filename: movedKey + "-summary.png"}
	stayedFile := db.FileRef{DirID: srcDir, Filename: stayedKey + "-summary.png"}
	mustNoErr(t, src.ReplaceFieldEvidence(movedFile, evidence))
	mustNoErr(t, src.ReplaceFieldEvidence(stayedFile, evidence))

	mustNoErr(t, profiles.Move(src, dst, []string{movedKey}))

	dstDir, err := dst.EnsureScreenshotsDir(dir)
	mustNoErr(t, err)
	onTarget, err := dst.LoadFieldEvidence()
	mustNoErr(t, err)
	want := map[db.FileRef]db.ScreenshotEvidence{{DirID: dstDir, Filename: movedFile.Filename}: evidence}
	if !reflect.DeepEqual(onTarget, want) {
		t.Errorf("target evidence = %+v, want %+v", onTarget, want)
	}
	onSource, err := src.LoadFieldEvidence()
	mustNoErr(t, err)
	if _, ok := onSource[movedFile]; ok {
		t.Error("the moved screenshot's evidence stayed on the source")
	}
	if _, ok := onSource[stayedFile]; !ok {
		t.Error("a screenshot that did not move lost its evidence")
	}
}
