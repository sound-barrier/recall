package aggregate_test

import (
	"image"
	"reflect"
	"testing"

	"recall/pkg/aggregate"
	"recall/pkg/db"
	"recall/pkg/match"
	"recall/pkg/parser"
)

// A match's field regions are the stored evidence of exactly its own
// screenshots, each tagged with the folder id a /_screenshot URL for that
// file carries, the same one source_dir_ids names.

const (
	regionsSummary = "Overwatch 2 Screenshot 2026.06.07 - 23.00.04.00.png"
	regionsTeams   = "Overwatch 2 Screenshot 2026.06.07 - 23.00.06.00.png"
	regionsOther   = "Overwatch 2 Screenshot 2026.06.08 - 20.00.00.00.png"
	regionsDir     = int64(7)
)

func evidenceAt(field parser.FieldPath, rect image.Rectangle) parser.FieldEvidence {
	return parser.FieldEvidence{Field: field, Rect: rect}
}

// regionsSnapshot is one match (m1) read from a SUMMARY in a known folder and
// a TEAMS in the configured one (the sentinel row the schema seeds), beside
// another match (m2) with its own evidence.
func regionsSnapshot() db.Screenshots {
	elims := parser.ScalarPath("eliminations")
	return db.Screenshots{
		Summaries: []db.SummaryRow{
			{Filename: regionsSummary, MatchKey: "m1", ScreenshotsDirID: regionsDir, Eliminations: 74},
			{Filename: regionsOther, MatchKey: "m2", ScreenshotsDirID: regionsDir, Eliminations: 3},
		},
		Teams: []db.TeamsRow{
			{Filename: regionsTeams, MatchKey: "m1", ScreenshotsDirID: db.SentinelScreenshotsDirID, Eliminations: 9},
		},
		ScreenshotsDirs: map[int64]string{db.SentinelScreenshotsDirID: "", regionsDir: "/shots"},
		FieldEvidence: map[db.FileRef]db.ScreenshotEvidence{
			{DirID: regionsDir, Filename: regionsSummary}: {ImageSize: image.Pt(1920, 1080), Fields: []parser.FieldEvidence{
				evidenceAt(parser.ScalarPath("deaths"), image.Rect(300, 600, 340, 640)),
				evidenceAt(elims, image.Rect(100, 600, 160, 640)),
			}},
			{DirID: db.SentinelScreenshotsDirID, Filename: regionsTeams}: {ImageSize: image.Pt(2560, 1440), Fields: []parser.FieldEvidence{
				evidenceAt(elims, image.Rect(1500, 400, 1540, 430)),
			}},
			{DirID: regionsDir, Filename: regionsOther}: {ImageSize: image.Pt(1920, 1080), Fields: []parser.FieldEvidence{
				evidenceAt(elims, image.Rect(1, 1, 2, 2)),
			}},
		},
	}
}

func TestFieldRegions_ComeFromTheMatchOwnScreenshots(t *testing.T) {
	got, found := aggregate.FieldRegions("m1", regionsSnapshot())

	if !found {
		t.Fatal("found = false for a key with screenshot rows")
	}
	want := []match.FieldRegion{
		{SourceFile: regionsSummary, DirID: regionsDir, Field: "data.deaths", X: 300, Y: 600, Width: 40, Height: 40, ImageWidth: 1920, ImageHeight: 1080},
		{SourceFile: regionsSummary, DirID: regionsDir, Field: "data.eliminations", X: 100, Y: 600, Width: 60, Height: 40, ImageWidth: 1920, ImageHeight: 1080},
		{SourceFile: regionsTeams, DirID: db.SentinelScreenshotsDirID, Field: "data.eliminations", X: 1500, Y: 400, Width: 40, Height: 30, ImageWidth: 2560, ImageHeight: 1440},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("regions =\n %+v\nwant\n %+v", got, want)
	}
}

// The folder id a region carries is the one the record's source_dir_ids
// gives the same file, so the crop and the screenshot it is cut from are
// asked for at one URL.
func TestFieldRegions_DirIDAgreesWithSourceDirIDs(t *testing.T) {
	snap := regionsSnapshot()
	// A folder row deleted since the parse: source_dir_ids drops the file.
	snap.Summaries[0].ScreenshotsDirID = 9
	snap.FieldEvidence[db.FileRef{DirID: 9, Filename: regionsSummary}] = snap.FieldEvidence[db.FileRef{DirID: regionsDir, Filename: regionsSummary}]

	regions, _ := aggregate.FieldRegions("m1", snap)
	recs := aggregate.Screenshots(snap)

	var rec match.Record
	for _, r := range recs {
		if r.MatchKey == "m1" {
			rec = r
		}
	}
	for _, region := range regions {
		if want := rec.SourceDirIDs[region.SourceFile]; region.DirID != want {
			t.Errorf("%s: dir_id = %d, source_dir_ids says %d", region.SourceFile, region.DirID, want)
		}
	}
	if len(regions) != 3 {
		t.Errorf("got %d regions, want 3 (a stale folder still finds the file's evidence)", len(regions))
	}
}

func TestFieldRegions_EmptyNeverNil(t *testing.T) {
	snap := regionsSnapshot()
	snap.FieldEvidence = nil

	for name, tc := range map[string]struct {
		key       string
		wantFound bool
	}{
		"rows parsed before evidence was stored": {"m1", true},
		"a key with no screenshot rows":          {"m3", false},
	} {
		t.Run(name, func(t *testing.T) {
			got, found := aggregate.FieldRegions(tc.key, snap)
			if found != tc.wantFound {
				t.Errorf("found = %v, want %v", found, tc.wantFound)
			}
			if got == nil || len(got) != 0 {
				t.Errorf("regions = %#v, want an empty non-nil slice", got)
			}
		})
	}
}
