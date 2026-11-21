package db_test

import (
	"image"
	"reflect"
	"testing"

	"recall/pkg/db"
	"recall/pkg/parser"
)

// Field evidence is where on a screenshot each reading came from. It belongs
// to the screenshot (folder + basename), not to the match the screenshot was
// filed under, so it lives exactly as long as the screenshot's row does and
// always describes the latest parse of it.

var shotSize = image.Pt(1920, 1080)

func elimsEvidence(rect image.Rectangle, template *parser.TemplateReading) parser.FieldEvidence {
	return parser.FieldEvidence{Field: parser.ScalarPath("eliminations"), Rect: rect, Template: template}
}

func deathsEvidence(rect image.Rectangle) parser.FieldEvidence {
	return parser.FieldEvidence{Field: parser.ScalarPath("deaths"), Rect: rect}
}

func evidenceOf(t *testing.T, s db.Store, file db.FileRef) (db.ScreenshotEvidence, bool) {
	t.Helper()
	all, err := s.LoadFieldEvidence()
	mustNoErr(t, err)
	ev, ok := all[file]
	return ev, ok
}

func TestStoreContract_FieldEvidenceRoundTripsRectsTemplatesAndSize(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			dir, _ := twoFolders(t, s)
			file := db.FileRef{DirID: dir, Filename: "shot.png"}
			want := db.ScreenshotEvidence{ImageSize: shotSize, Fields: []parser.FieldEvidence{
				deathsEvidence(image.Rect(300, 40, 340, 70)),
				elimsEvidence(image.Rect(100, 40, 160, 70), &parser.TemplateReading{Value: "9", Score: 0.9375, Margin: 0.125}),
			}}
			mustNoErr(t, s.ReplaceFieldEvidence(file, want))

			got, ok := evidenceOf(t, s, file)
			if !ok {
				t.Fatal("no evidence recorded for the screenshot")
			}
			if !reflect.DeepEqual(got, want) {
				t.Errorf("evidence = %+v, want %+v", got, want)
			}
		})
	}
}

func TestStoreContract_ReparseRewritesRectsAndDropsVanishedFields(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			dir, _ := twoFolders(t, s)
			file := db.FileRef{DirID: dir, Filename: "shot.png"}
			mustNoErr(t, s.ReplaceFieldEvidence(file, db.ScreenshotEvidence{ImageSize: shotSize, Fields: []parser.FieldEvidence{
				deathsEvidence(image.Rect(300, 40, 340, 70)),
				elimsEvidence(image.Rect(100, 40, 160, 70), &parser.TemplateReading{Value: "9", Score: 0.9, Margin: 0.1}),
			}}))

			reparse := db.ScreenshotEvidence{ImageSize: image.Pt(2560, 1440), Fields: []parser.FieldEvidence{
				elimsEvidence(image.Rect(130, 50, 210, 90), nil),
			}}
			mustNoErr(t, s.ReplaceFieldEvidence(file, reparse))

			got, _ := evidenceOf(t, s, file)
			if !reflect.DeepEqual(got, reparse) {
				t.Errorf("after re-parse evidence = %+v, want exactly %+v", got, reparse)
			}
		})
	}
}

// A parse that read nothing (an Unknown screen) leaves no record behind, not
// the regions an earlier parse of the same file read.
func TestStoreContract_EmptyEvidenceForgetsTheScreenshot(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			dir, _ := twoFolders(t, s)
			file := db.FileRef{DirID: dir, Filename: "shot.png"}
			mustNoErr(t, s.ReplaceFieldEvidence(file, db.ScreenshotEvidence{ImageSize: shotSize, Fields: []parser.FieldEvidence{
				deathsEvidence(image.Rect(300, 40, 340, 70)),
			}}))
			mustNoErr(t, s.ReplaceFieldEvidence(file, db.ScreenshotEvidence{}))
			if got, ok := evidenceOf(t, s, file); ok {
				t.Errorf("empty re-parse left %+v behind", got)
			}
		})
	}
}

func TestStoreContract_FieldEvidenceIsKeyedByFolder(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			a, b := twoFolders(t, s)
			inA := db.ScreenshotEvidence{ImageSize: shotSize, Fields: []parser.FieldEvidence{deathsEvidence(image.Rect(1, 2, 3, 4))}}
			inB := db.ScreenshotEvidence{ImageSize: shotSize, Fields: []parser.FieldEvidence{deathsEvidence(image.Rect(5, 6, 7, 8))}}
			mustNoErr(t, s.ReplaceFieldEvidence(db.FileRef{DirID: a, Filename: "x.png"}, inA))
			mustNoErr(t, s.ReplaceFieldEvidence(db.FileRef{DirID: b, Filename: "x.png"}, inB))
			mustNoErr(t, s.ReplaceFieldEvidence(db.FileRef{DirID: b, Filename: "x.png"}, db.ScreenshotEvidence{}))

			got, ok := evidenceOf(t, s, db.FileRef{DirID: a, Filename: "x.png"})
			if !ok || !reflect.DeepEqual(got, inA) {
				t.Errorf("folder A's x.png = %+v (present %v), want %+v — a re-parse in folder B reached it", got, ok, inA)
			}
		})
	}
}

// seedEvidencedSummary files one screenshot under key with a recorded region.
func seedEvidencedSummary(t *testing.T, s db.Store, dir int64, key, filename string) db.FileRef {
	t.Helper()
	mustNoErr(t, s.UpsertSummary(db.SummaryRow{Filename: filename, MatchKey: key, ScreenshotsDirID: dir, Result: "victory"}))
	file := db.FileRef{DirID: dir, Filename: filename}
	mustNoErr(t, s.ReplaceFieldEvidence(file, db.ScreenshotEvidence{ImageSize: shotSize, Fields: []parser.FieldEvidence{
		deathsEvidence(image.Rect(300, 40, 340, 70)),
	}}))
	return file
}

func TestStoreContract_HardDeleteTakesOnlyItsOwnScreenshotsEvidence(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			dir, _ := twoFolders(t, s)
			doomed := seedEvidencedSummary(t, s, dir, "match:doomed", "doomed.png")
			kept := seedEvidencedSummary(t, s, dir, "match:kept", "kept.png")

			mustNoErr(t, s.HardDeleteMatch("match:doomed"))

			if _, ok := evidenceOf(t, s, doomed); ok {
				t.Error("a hard-deleted match's screenshot kept its evidence")
			}
			if _, ok := evidenceOf(t, s, kept); !ok {
				t.Error("hard-deleting one match took another match's evidence")
			}
		})
	}
}

func TestStoreContract_ClearWipesFieldEvidence(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			dir, _ := twoFolders(t, s)
			seedEvidencedSummary(t, s, dir, "match:a", "a.png")
			mustNoErr(t, s.Clear())
			all, err := s.LoadFieldEvidence()
			mustNoErr(t, err)
			if len(all) != 0 {
				t.Errorf("Clear left evidence for %d screenshots", len(all))
			}
		})
	}
}

// Dismiss deletes a screenshot's rows by name; the regions it was read from
// go with them, or a later parse of a same-named file would inherit them.
func TestStoreContract_DismissWipesFieldEvidence(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			dir, _ := twoFolders(t, s)
			file := seedEvidencedSummary(t, s, dir, "match:a", "a.png")
			_, err := s.DeleteScreenshotRows("a.png")
			mustNoErr(t, err)
			if _, ok := evidenceOf(t, s, file); ok {
				t.Error("a dismissed screenshot kept its evidence")
			}
		})
	}
}

// An Unknown row retired because the parser now recognizes a non-match
// screen takes its evidence with it.
func TestStoreContract_RetiringAnUnknownWipesItsEvidence(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			dir, _ := twoFolders(t, s)
			mustNoErr(t, s.UpsertUnknown(db.UnknownRow{Filename: "u.png", MatchKey: "unmatched:u.png", ScreenshotsDirID: dir}))
			file := db.FileRef{DirID: dir, Filename: "u.png"}
			mustNoErr(t, s.ReplaceFieldEvidence(file, db.ScreenshotEvidence{ImageSize: shotSize, Fields: []parser.FieldEvidence{
				deathsEvidence(image.Rect(1, 1, 9, 9)),
			}}))
			mustNoErr(t, s.DeleteUnknownScreenshot("u.png"))
			if _, ok := evidenceOf(t, s, file); ok {
				t.Error("a retired Unknown row kept its evidence")
			}
		})
	}
}

// The open-time GC must not trip over a folder only evidence still names:
// screenshots_dir_id is RESTRICT, and a failed prune fails the store open.
func TestSQLStore_PruneScreenshotsDirsKeepsAFolderEvidenceNames(t *testing.T) {
	s := openMemory(t)
	dir, err := s.EnsureScreenshotsDir("/only-evidence")
	mustNoErr(t, err)
	file := db.FileRef{DirID: dir, Filename: "x.png"}
	mustNoErr(t, s.ReplaceFieldEvidence(file, db.ScreenshotEvidence{ImageSize: shotSize, Fields: []parser.FieldEvidence{
		deathsEvidence(image.Rect(1, 1, 9, 9)),
	}}))
	if _, err := s.PruneScreenshotsDirs(); err != nil {
		t.Fatalf("PruneScreenshotsDirs: %v", err)
	}
	if _, ok := evidenceOf(t, s, file); !ok {
		t.Error("prune dropped evidence")
	}
}

// Records the schema's CHECK constraints, primary key and folder foreign
// key refuse. Both stores must refuse each one, and a refused write must
// leave the screenshot's earlier record exactly as it was.
var invalidEvidence = map[string]db.ScreenshotEvidence{
	"regions without an image size": {Fields: []parser.FieldEvidence{deathsEvidence(image.Rect(300, 40, 340, 70))}},
	"a zero image height":           {ImageSize: image.Pt(1920, 0)},
	"a zero-width region": {ImageSize: shotSize, Fields: []parser.FieldEvidence{
		deathsEvidence(image.Rect(300, 40, 300, 70)),
	}},
	"a region left of the image": {ImageSize: shotSize, Fields: []parser.FieldEvidence{
		deathsEvidence(image.Rect(-5, 40, 30, 70)),
	}},
	"an empty field path": {ImageSize: shotSize, Fields: []parser.FieldEvidence{
		{Rect: image.Rect(300, 40, 340, 70)},
	}},
	"one field read twice": {ImageSize: shotSize, Fields: []parser.FieldEvidence{
		deathsEvidence(image.Rect(300, 40, 340, 70)), deathsEvidence(image.Rect(1, 1, 9, 9)),
	}},
}

func TestStoreContract_RefusedEvidenceKeepsTheEarlierRecord(t *testing.T) {
	for _, impl := range storeImpls {
		for name, bad := range invalidEvidence {
			t.Run(impl.name+"/"+name, func(t *testing.T) {
				s := impl.open(t)
				dir, _ := twoFolders(t, s)
				file := db.FileRef{DirID: dir, Filename: "shot.png"}
				earlier := db.ScreenshotEvidence{ImageSize: shotSize, Fields: []parser.FieldEvidence{
					elimsEvidence(image.Rect(100, 40, 160, 70), nil),
				}}
				mustNoErr(t, s.ReplaceFieldEvidence(file, earlier))

				if err := s.ReplaceFieldEvidence(file, bad); err == nil {
					t.Fatalf("ReplaceFieldEvidence(%+v) = nil, want a refusal", bad)
				}
				if got, ok := evidenceOf(t, s, file); !ok || !reflect.DeepEqual(got, earlier) {
					t.Errorf("after a refused write evidence = %+v (present %v), want the earlier %+v", got, ok, earlier)
				}
			})
		}
	}
}

func TestStoreContract_EvidenceForAnUnknownFolderIsRefused(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			a, b := twoFolders(t, s)
			nowhere := db.FileRef{DirID: a + b + 100, Filename: "shot.png"}
			ev := db.ScreenshotEvidence{ImageSize: shotSize, Fields: []parser.FieldEvidence{
				deathsEvidence(image.Rect(300, 40, 340, 70)),
			}}
			if err := s.ReplaceFieldEvidence(nowhere, ev); err == nil {
				t.Fatal("evidence filed under a folder with no screenshots_dirs row was accepted")
			}
			if _, ok := evidenceOf(t, s, nowhere); ok {
				t.Error("a refused write left a record behind")
			}
		})
	}
}
