package bundle_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"recall/pkg/bundle"
	"recall/pkg/db"
	"recall/pkg/db/dbtest"
)

// exportedData decodes the data.json a bundle payload carries.
func exportedData(t *testing.T, payload []byte) bundle.DataV2 {
	t.Helper()
	var d bundle.DataV2
	if err := json.Unmarshal(readZip(t, payload)["data.json"], &d); err != nil {
		t.Fatalf("decode data.json: %v", err)
	}
	return d
}

// exportedManifest decodes the manifest.json a bundle payload carries.
func exportedManifest(t *testing.T, payload []byte) bundle.ManifestV1 {
	t.Helper()
	var mf bundle.ManifestV1
	if err := json.Unmarshal(readZip(t, payload)["manifest.json"], &mf); err != nil {
		t.Fatalf("decode manifest.json: %v", err)
	}
	return mf
}

// An export that can't read part of the database must fail loudly: a bundle
// silently missing its reviews (or its hidden flags) looks complete and is
// discovered to be lossy only after the user has wiped the source machine.
func TestExport_SurfacesEveryStoreFailure(t *testing.T) {
	tests := []struct {
		method  string
		wantMsg string
	}{
		{"LoadAll", "export bundle: load: store down"},
		{"LoadAllUserMatchData", "export bundle: load user data: store down"},
		{"LoadAnnotations", "export bundle: load annotations: store down"},
		{"LoadReviews", "export bundle: load reviews: store down"},
		{"LoadMatchQueues", "export bundle: load queues: store down"},
		{"LoadMatchPlayModes", "export bundle: load play modes: store down"},
		{"LoadHiddenKeys", "export bundle: load hidden keys: store down"},
	}
	for _, tc := range tests {
		t.Run(tc.method, func(t *testing.T) {
			opts := bundle.ExportBundleOptions{MatchKeys: []string{"m1"}}
			payload, err := bundle.Export(newFailingStore(tc.method), opts, nil, t.TempDir(), seededVersion)
			if err == nil || err.Error() != tc.wantMsg {
				t.Fatalf("err = %v, want %q", err, tc.wantMsg)
			}
			if payload != nil {
				t.Error("a failed export must not hand back a half-built bundle")
			}
		})
	}
}

// A row remembers which folder its screenshot came from, so a user who moved
// their screenshots folder (re-install, second PC) still exports real bytes for
// the old rows. An id that no longer resolves falls back to the live folder
// rather than dropping the file.
func TestExport_ResolvesPerRowScreenshotsDirWithFallback(t *testing.T) {
	archived, live := t.TempDir(), t.TempDir()
	writeShots(t, archived, "old.png")
	writeShots(t, live, "current.png", "stale-id.png")

	store := dbtest.New()
	store.DirIDs = map[string]int64{archived: 5}
	store.Summaries = []db.SummaryRow{{Filename: "old.png", MatchKey: "m1", ScreenshotsDirID: 5}}
	store.Teams = []db.TeamsRow{{Filename: "current.png", MatchKey: "m1"}}
	store.Personals = []db.PersonalRow{{Filename: "stale-id.png", MatchKey: "m1", ScreenshotsDirID: 42}}

	payload, err := bundle.Export(store, bundle.ExportBundleOptions{MatchKeys: []string{"m1"}}, nil, live, seededVersion)
	if err != nil {
		t.Fatalf("Export: %v", err)
	}
	entries := readZip(t, payload)
	for _, name := range []string{"old.png", "current.png", "stale-id.png"} {
		got, ok := entries["screenshots/"+name]
		if !ok {
			t.Errorf("screenshots/%s missing from the bundle", name)
			continue
		}
		if string(got) != "png-"+name {
			t.Errorf("screenshots/%s carries %q", name, got)
		}
	}
}

// A vanished screenshot is expected and gets pruned; anything else is a real
// I/O failure and must not be laundered into a silently smaller bundle.
func TestExport_UnreadableScreenshotIsAnErrorNotAPrune(t *testing.T) {
	shots := t.TempDir()
	if err := os.Mkdir(filepath.Join(shots, "not-a-file.png"), 0o750); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	store := dbtest.New()
	store.Summaries = []db.SummaryRow{{Filename: "not-a-file.png", MatchKey: "m1"}}

	_, err := bundle.Export(store, bundle.ExportBundleOptions{MatchKeys: []string{"m1"}}, nil, shots, seededVersion)
	if err == nil {
		t.Fatal("an unreadable screenshot must fail the export, not be skipped like a missing one")
	}
	if want := "export bundle: read not-a-file.png: "; err.Error()[:len(want)] != want {
		t.Fatalf("err = %q, want it to start %q", err, want)
	}
}

// The manifest is written after the screenshot copy precisely so its map and
// its count describe what actually landed in the ZIP — otherwise the bundle
// fails its own validator the moment one screenshot has been deleted.
func TestExport_PrunesVanishedScreenshotFromManifestAndCount(t *testing.T) {
	shots := t.TempDir()
	store := seededStore(t, shots)
	writeShots(t, shots, seededParentFiles()...) // unknown-3.png deliberately absent

	payload, err := bundle.Export(store, bundle.ExportBundleOptions{MatchKeys: seededKeys()}, nil, shots, seededVersion)
	if err != nil {
		t.Fatalf("Export: %v", err)
	}
	mf := exportedManifest(t, payload)
	if _, listed := mf.Screenshots["unknown-3.png"]; listed {
		t.Error("manifest still lists a screenshot that isn't in the ZIP")
	}
	if mf.ScreenshotCount != len(mf.Screenshots) || mf.ScreenshotCount != 4 {
		t.Errorf("screenshot_count = %d, screenshots map = %d, want both 4", mf.ScreenshotCount, len(mf.Screenshots))
	}
	if mf.MatchCount != 4 {
		t.Errorf("match_count = %d, want 4 — the manual match has no screenshot but is still a match", mf.MatchCount)
	}
	// The row survives even though its image didn't, so a later re-parse can
	// still find the match.
	if len(exportedData(t, payload).Unknowns) != 1 {
		t.Error("the row whose screenshot vanished was dropped from data.json")
	}
}

// The include set gates the user layer too. A bundle shared with a coach must
// not carry notes, review state, or queue overrides for matches the user never
// selected.
func TestExport_UserLayerIsRestrictedToTheIncludedKeys(t *testing.T) {
	shots := t.TempDir()
	store := seededStore(t, shots)
	writeShots(t, shots, seededParentFiles()...)

	payload, err := bundle.Export(store, bundle.ExportBundleOptions{MatchKeys: []string{"m1"}}, nil, shots, seededVersion)
	if err != nil {
		t.Fatalf("Export: %v", err)
	}
	d := exportedData(t, payload)
	if len(d.Annotations) != 0 {
		t.Errorf("annotations leaked for unselected keys: %+v", d.Annotations)
	}
	if _, ok := d.Queues["m2"]; ok {
		t.Errorf("queue state leaked for m2: %+v", d.Queues)
	}
	if _, ok := d.PlayModes["m3"]; ok {
		t.Errorf("play-mode state leaked for m3: %+v", d.PlayModes)
	}
	if len(d.Hidden) != 0 {
		t.Errorf("hidden flags leaked: %v", d.Hidden)
	}
	if _, ok := d.Reviews["m1"]; !ok {
		t.Errorf("the selected key's own review went missing: %+v", d.Reviews)
	}
	if len(d.UserMatchData) != 1 || d.UserMatchData[0].MatchKey != "m1" {
		t.Errorf("user_match_data = %+v, want only m1", d.UserMatchData)
	}
}

// Slice-shaped sections sort by match_key so two exports of the same selection
// produce the same bytes — Go's map iteration order would otherwise reshuffle
// them on every run.
func TestExport_SliceSectionsSortByMatchKey(t *testing.T) {
	store := dbtest.New()
	keys := []string{"z-last", "a-first", "m-middle"}
	store.UserMatchData = map[string]db.UserMatchData{}
	store.Annotations = map[string]db.Annotation{}
	store.Hidden = map[string]bool{}
	for _, k := range keys {
		store.UserMatchData[k] = db.UserMatchData{MatchKey: k}
		store.Annotations[k] = db.Annotation{MatchKey: k, Note: "n"}
		store.Hidden[k] = true
	}

	payload, err := bundle.Export(store, bundle.ExportBundleOptions{MatchKeys: keys}, nil, t.TempDir(), seededVersion)
	if err != nil {
		t.Fatalf("Export: %v", err)
	}
	d := exportedData(t, payload)
	want := []string{"a-first", "m-middle", "z-last"}
	gotUser := make([]string, 0, len(d.UserMatchData))
	for _, u := range d.UserMatchData {
		gotUser = append(gotUser, u.MatchKey)
	}
	gotAnn := make([]string, 0, len(d.Annotations))
	for _, a := range d.Annotations {
		gotAnn = append(gotAnn, a.MatchKey)
	}
	if !slices.Equal(gotUser, want) || !slices.Equal(gotAnn, want) || !slices.Equal(d.Hidden, want) {
		t.Errorf("order: user=%v annotations=%v hidden=%v, want %v", gotUser, gotAnn, d.Hidden, want)
	}
}
