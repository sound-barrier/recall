package bundle_test

import (
	"errors"
	"maps"
	"strings"
	"testing"

	"recall/pkg/bundle"
	"recall/pkg/db"
	"recall/pkg/db/dbtest"
)

// allTablesData carries one row in every parent table plus one of every
// user-layer surface, so a single payload can drive each write the import path
// makes.
func allTablesData() map[string]any {
	return map[string]any{
		"schema":          dataSchemaV2,
		"summaries":       []map[string]any{{"Filename": "s.png", "MatchKey": "m1"}},
		"teams":           []map[string]any{{"Filename": "t.png", "MatchKey": "m1"}},
		"personals":       []map[string]any{{"Filename": "p.png", "MatchKey": "m1"}},
		"ranks":           []map[string]any{{"Filename": "r.png", "MatchKey": "m1"}},
		"unknowns":        []map[string]any{{"Filename": "u.png", "MatchKey": "m1"}},
		"user_match_data": []map[string]any{{"MatchKey": "m9"}},
		"annotations":     []map[string]any{{"MatchKey": "m1", "Note": "n"}},
		"reviews":         map[string]any{"m1": map[string]any{"ReviewedBy": "coach"}},
		"queues":          map[string]any{"m1": map[string]any{"QueueType": "role"}},
		"play_modes":      map[string]any{"m1": map[string]any{"PlayMode": "competitive"}},
		"hidden":          []string{"m1"},
		"pinned":          []string{"m1"},
		"coach_notes":     []map[string]any{{"NoteID": "n-1", "MatchKey": "m1", "CoachName": "Ordo", "Text": "t"}},
	}
}

func payloadWithData(t *testing.T, data map[string]any) []byte {
	t.Helper()
	return buildZip(t,
		jsonFileEntry(t, "manifest.json", okManifest()),
		jsonFileEntry(t, "data.json", data),
	)
}

// The round trip is the whole point of the format: whatever a user exports has
// to come back byte-for-byte in meaning, children included, with the one
// deliberate exception that every screenshots-dir reference collapses to the
// sentinel (the bundle strips filesystem paths, so the importing machine's
// configured folder wins).
func TestImport_RoundTripFromExportPreservesEveryTable(t *testing.T) {
	shots := t.TempDir()
	src := seededStore(t, shots)
	writeShots(t, shots, seededParentFiles()...)

	payload, err := bundle.Export(src, bundle.ExportBundleOptions{MatchKeys: seededKeys()}, nil, shots, seededVersion)
	if err != nil {
		t.Fatalf("Export: %v", err)
	}

	dst := dbtest.New()
	summary, err := bundle.Import(dst, payload)
	if err != nil {
		t.Fatalf("Import: %v", err)
	}
	if summary.Imported != 4 || summary.Skipped != 0 {
		t.Fatalf("summary = %+v, want {Imported:4 Skipped:0} (m1, m2, m3 + the manual match)", summary)
	}
	assertParentRowsRoundTripped(t, dst)
	assertUserLayerRoundTripped(t, dst)
}

func assertParentRowsRoundTripped(t *testing.T, dst *dbtest.Fake) {
	t.Helper()
	if n := len(dst.Summaries) + len(dst.Teams) + len(dst.Personals) + len(dst.Ranks) + len(dst.Unknowns); n != 5 {
		t.Fatalf("parent rows = %d, want 5 (one per table)", n)
	}
	assertSummaryRoundTripped(t, dst.Summaries[0])
	assertCombatRowsRoundTripped(t, dst)
	assertRankRowRoundTripped(t, dst.Ranks[0])
	if dst.Unknowns[0].MatchKey != "m3" {
		t.Errorf("unknown row = %+v", dst.Unknowns[0])
	}
	assertDirsCollapsedToSentinel(t, dst)
}

func assertSummaryRoundTripped(t *testing.T, s db.SummaryRow) {
	t.Helper()
	if s.Filename != "summary-1.png" || s.MatchKey != "m1" || s.Map != "ilios" || s.PerfElimTotal != 21 {
		t.Errorf("summary = %+v", s)
	}
	if len(s.HeroesPlayed) != 1 || s.HeroesPlayed[0].Hero != "ana" || s.HeroesPlayed[0].PlayTime != "08:12" {
		t.Errorf("summary heroes_played lost in transit: %+v", s.HeroesPlayed)
	}
}

func assertCombatRowsRoundTripped(t *testing.T, dst *dbtest.Fake) {
	t.Helper()
	if h := dst.Teams[0].HeroStats; len(h) != 1 || h[0].StatValue != 21 || dst.Teams[0].QueueType != "role" {
		t.Errorf("teams row = %+v", dst.Teams[0])
	}
	if h := dst.Personals[0].HeroStats; len(h) != 1 || h[0].StatKey != "nano_boost_assists" {
		t.Errorf("personal hero stats = %+v", h)
	}
}

func assertRankRowRoundTripped(t *testing.T, r db.RankRow) {
	t.Helper()
	if len(r.Modifiers) != 1 || r.Modifiers[0] != "win streak" || len(r.SR) != 1 || r.SR[0].SR != 3210 {
		t.Errorf("rank sidecars = %+v / %+v", r.Modifiers, r.SR)
	}
}

// Every imported row's screenshots-dir reference must land on the sentinel:
// the exporting machine's folder ids are meaningless here, and carrying them
// through would point the screenshot handler at a directory that doesn't exist.
func assertDirsCollapsedToSentinel(t *testing.T, dst *dbtest.Fake) {
	t.Helper()
	got := []int64{
		dst.Summaries[0].ScreenshotsDirID, dst.Teams[0].ScreenshotsDirID,
		dst.Personals[0].ScreenshotsDirID, dst.Ranks[0].ScreenshotsDirID,
		dst.Unknowns[0].ScreenshotsDirID,
	}
	for i, id := range got {
		if id != db.SentinelScreenshotsDirID {
			t.Errorf("row %d screenshots_dir_id = %d, want the sentinel %d", i, id, db.SentinelScreenshotsDirID)
		}
	}
}

func assertUserLayerRoundTripped(t *testing.T, dst *dbtest.Fake) {
	t.Helper()
	assertUserOverridesRoundTripped(t, dst)
	assertSidecarStatesRoundTripped(t, dst)
}

func assertUserOverridesRoundTripped(t *testing.T, dst *dbtest.Fake) {
	t.Helper()
	edited, ok := dst.UserMatchData["m1"]
	if !ok || edited.Eliminations == nil || *edited.Eliminations != 30 {
		t.Errorf("inline edit on m1 lost: %+v", edited)
	}
	manual, ok := dst.UserMatchData[manualKey]
	if !ok || manual.Hero == nil || *manual.Hero != "lucio" {
		t.Errorf("manual match lost: %+v", manual)
	}
}

func assertSidecarStatesRoundTripped(t *testing.T, dst *dbtest.Fake) {
	t.Helper()
	if a := dst.Annotations["m2"]; a.Note != "threw" || len(a.Tags) != 1 || a.Tags[0] != "stack" {
		t.Errorf("annotation = %+v", a)
	}
	if dst.Reviews["m1"].ReviewedBy != "coach" {
		t.Errorf("review = %+v", dst.Reviews["m1"])
	}
	if dst.Queues["m2"].QueueType != "role" {
		t.Errorf("queue = %+v", dst.Queues["m2"])
	}
	if dst.PlayModes["m3"].PlayMode != "competitive" {
		t.Errorf("play mode = %+v", dst.PlayModes["m3"])
	}
	if !dst.Hidden["m3"] {
		t.Error("hidden flag on m3 lost")
	}
	// A star is hand-curated state exactly like a note or a hidden flag: an
	// export→import round trip that drops it silently un-stars every match the
	// user marked, and nothing in the UI says so.
	if !dst.Pinned["m1"] || !dst.Pinned["m2"] {
		t.Errorf("pinned flags lost in transit: %v", dst.Pinned)
	}
}

// Re-importing a bundle you already imported must be a no-op that SAYS so.
// Every distinct match_key the bundle carries lands in exactly one counter, so
// a bundle of hand-entered matches can't come back as "0 imported, 0 skipped"
// — indistinguishable, to the user, from an empty file.
func TestImport_ReimportIsIdempotentAndCountsEveryKey(t *testing.T) {
	shots := t.TempDir()
	src := seededStore(t, shots)
	writeShots(t, shots, seededParentFiles()...)
	payload, err := bundle.Export(src, bundle.ExportBundleOptions{MatchKeys: seededKeys()}, nil, shots, seededVersion)
	if err != nil {
		t.Fatalf("Export: %v", err)
	}

	dst := dbtest.New()
	if _, err := bundle.Import(dst, payload); err != nil {
		t.Fatalf("first Import: %v", err)
	}
	before := len(dst.Summaries) + len(dst.Teams) + len(dst.Personals) + len(dst.Ranks) + len(dst.Unknowns)

	summary, err := bundle.Import(dst, payload)
	if err != nil {
		t.Fatalf("second Import: %v", err)
	}
	if summary.Imported != 0 || summary.Skipped != 4 {
		t.Errorf("re-import summary = %+v, want {Imported:0 Skipped:4} (three OCR keys + the manual match)", summary)
	}
	after := len(dst.Summaries) + len(dst.Teams) + len(dst.Personals) + len(dst.Ranks) + len(dst.Unknowns)
	if after != before {
		t.Errorf("re-import duplicated rows: %d → %d", before, after)
	}
}

// "An incoming key you already have is skipped wholesale, so a merge can never
// clobber local edits" — the doc comment's promise, held to across every
// user-layer surface at once.
func TestImport_ExistingKeyKeepsLocalEditsIntact(t *testing.T) {
	dst := seedLocalEdits(t)
	payload := payloadWithData(t, map[string]any{
		"schema":          dataSchemaV2,
		"summaries":       []map[string]any{{"Filename": "a.png", "MatchKey": "m1", "Map": "junkertown"}},
		"user_match_data": []map[string]any{{"MatchKey": "m1", "Map": "numbani"}},
		"annotations":     []map[string]any{{"MatchKey": "m1", "Note": "incoming note"}},
		"reviews":         map[string]any{"m1": map[string]any{"ReviewedBy": "stranger"}},
		"queues":          map[string]any{"m1": map[string]any{"QueueType": "open"}},
		"play_modes":      map[string]any{"m1": map[string]any{"PlayMode": "quickplay"}},
		"hidden":          []string{"m1"},
	})

	summary, err := bundle.Import(dst, payload)
	if err != nil {
		t.Fatalf("Import: %v", err)
	}
	if summary.Imported != 0 || summary.Skipped != 1 {
		t.Errorf("summary = %+v, want {Imported:0 Skipped:1}", summary)
	}
	assertLocalEditsSurvived(t, dst)
}

func seedLocalEdits(t *testing.T) *dbtest.Fake {
	t.Helper()
	f := dbtest.New()
	f.Summaries = []db.SummaryRow{{ID: 1, Filename: "a.png", MatchKey: "m1", Map: "ilios"}}
	f.UserMatchData = map[string]db.UserMatchData{"m1": {MatchKey: "m1", Map: new("my-correction")}}
	f.Annotations = map[string]db.Annotation{"m1": {MatchKey: "m1", Note: "my note"}}
	f.Reviews = map[string]db.ReviewState{"m1": {ReviewedBy: "me", ReviewedAt: "2026-05-01T00:00:00Z"}}
	f.Queues = map[string]db.QueueState{"m1": {QueueType: "role", OverriddenAt: "2026-05-01T00:00:00Z"}}
	f.PlayModes = map[string]db.PlayModeState{"m1": {PlayMode: "competitive", OverriddenAt: "2026-05-01T00:00:00Z"}}
	return f
}

func assertLocalEditsSurvived(t *testing.T, dst *dbtest.Fake) {
	t.Helper()
	if dst.Summaries[0].Map != "ilios" {
		t.Errorf("summary map = %q, want the local ilios", dst.Summaries[0].Map)
	}
	if got := dst.UserMatchData["m1"].Map; got == nil || *got != "my-correction" {
		t.Errorf("user override overwritten: %v", got)
	}
	if dst.Annotations["m1"].Note != "my note" {
		t.Errorf("annotation = %q, want the local note", dst.Annotations["m1"].Note)
	}
	if dst.Reviews["m1"].ReviewedBy != "me" || dst.Queues["m1"].QueueType != "role" {
		t.Errorf("review/queue overwritten: %+v / %+v", dst.Reviews["m1"], dst.Queues["m1"])
	}
	if dst.PlayModes["m1"].PlayMode != "competitive" {
		t.Errorf("play mode = %q, want the local competitive", dst.PlayModes["m1"].PlayMode)
	}
	if dst.Hidden["m1"] {
		t.Error("incoming hidden flag hid a match the user had visible")
	}
}

// Filename is the UNIQUE upsert key on every parent table, so a row that lost
// it (hand-edited JSON, or a literal `null` array entry Go decodes into a
// zero-value struct) has to be named — table AND index — before anything is
// written.
func TestImport_RejectsRowWithoutFilename(t *testing.T) {
	tests := []struct {
		name    string
		rows    map[string]any
		wantMsg string
	}{
		{"summaries", map[string]any{"summaries": twoRows()}, "import: summaries[1] missing required filename"},
		{"teams", map[string]any{"teams": twoRows()}, "import: teams[1] missing required filename"},
		{"personals", map[string]any{"personals": twoRows()}, "import: personals[1] missing required filename"},
		{"ranks", map[string]any{"ranks": twoRows()}, "import: ranks[1] missing required filename"},
		{"unknowns", map[string]any{"unknowns": twoRows()}, "import: unknowns[1] missing required filename"},
		{"null array entry", map[string]any{"summaries": []any{nil}}, "import: summaries[0] missing required filename"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			data := map[string]any{"schema": dataSchemaV2}
			maps.Copy(data, tc.rows)
			store := dbtest.New()
			_, err := bundle.Import(store, payloadWithData(t, data))
			if err == nil || err.Error() != tc.wantMsg {
				t.Fatalf("err = %v, want %q", err, tc.wantMsg)
			}
			if store.UpsertCalls != 0 {
				t.Errorf("%d rows were written before the bad row was found; a rejected bundle must not half-import", store.UpsertCalls)
			}
		})
	}
}

// One file is one screenshot of one TYPE. A parse maintains that by calling
// DeleteScreenshotSiblings; the import path never did, so a payload naming
// the same file under two parent tables imported cleanly — and the
// aggregator then folded one image twice into one match, claiming both
// source types and double-counting it in the Re-parse-All tally.
func TestImport_RejectsOneFilenameClaimedByTwoTables(t *testing.T) {
	data := map[string]any{
		"schema":    dataSchemaV2,
		"summaries": []map[string]any{{"Filename": "shot.png", "MatchKey": "m1"}},
		"teams":     []map[string]any{{"Filename": "shot.png", "MatchKey": "m1"}},
	}
	store := dbtest.New()
	_, err := bundle.Import(store, payloadWithData(t, data))
	if err == nil || !strings.Contains(err.Error(), "which summaries already claims") {
		t.Fatalf("err = %v, want the two tables named", err)
	}
	if store.UpsertCalls != 0 {
		t.Errorf("%d rows written before the clash was found; a rejected bundle must not half-import",
			store.UpsertCalls)
	}
}

func twoRows() []map[string]any {
	return []map[string]any{
		{"Filename": "ok.png", "MatchKey": "m1"},
		{"Filename": "", "MatchKey": "m2"},
	}
}

// No store failure may be swallowed, and none of them is a malformed payload:
// the bundle was readable, the database refused it. Each case pins the wrapped
// message that tells the user which write went wrong.
func TestImport_SurfacesEveryStoreFailure(t *testing.T) {
	tests := []struct {
		method  string
		wantMsg string
	}{
		{"LoadMatchKeys", "import: load existing: store down"},
		{"UpsertSummary", `import: summary "s.png": store down`},
		{"UpsertTeams", `import: teams "t.png": store down`},
		{"UpsertPersonal", `import: personal "p.png": store down`},
		{"UpsertRank", `import: rank "r.png": store down`},
		{"UpsertUnknown", `import: unknown "u.png": store down`},
		{"UpsertUserMatchData", `import: user data for "m9": store down`},
		{"SetAnnotationAt", `import: annotation for "m1": store down`},
		{"SetReviewAt", `import: review for "m1": store down`},
		{"SetMatchQueue", `import: queue for "m1": store down`},
		{"SetMatchPlayMode", `import: play mode for "m1": store down`},
		{"HideMatch", `import: hidden flag for "m1": store down`},
		{"PinMatch", `import: pinned flag for "m1": store down`},
		{"UpsertMatchCoachNote", `import: coach note for "m1": store down`},
	}
	payload := payloadWithData(t, allTablesData())
	for _, tc := range tests {
		t.Run(tc.method, func(t *testing.T) {
			_, err := bundle.Import(newFailingStore(tc.method), payload)
			if err == nil || err.Error() != tc.wantMsg {
				t.Fatalf("err = %v, want %q", err, tc.wantMsg)
			}
			if !errors.Is(err, errStoreDown) {
				t.Error("store error must stay unwrappable-to via %w")
			}
			if errors.Is(err, bundle.ErrImportMalformed) {
				t.Error("a store failure is a 409, not a malformed payload")
			}
		})
	}
}

// An empty value in a keyed section is "no state", not "set it to empty" —
// writing it would stamp a bogus timestamp onto a match nobody reviewed.
func TestImport_SkipsEmptyKeyedSectionValues(t *testing.T) {
	store := dbtest.New()
	payload := payloadWithData(t, map[string]any{
		"schema":     dataSchemaV2,
		"summaries":  []map[string]any{{"Filename": "a.png", "MatchKey": "m1"}},
		"reviews":    map[string]any{"m1": map[string]any{"ReviewedBy": ""}},
		"queues":     map[string]any{"m1": map[string]any{"QueueType": ""}},
		"play_modes": map[string]any{"m1": map[string]any{"PlayMode": ""}},
	})
	if _, err := bundle.Import(store, payload); err != nil {
		t.Fatalf("Import: %v", err)
	}
	if len(store.Reviews) != 0 || len(store.Queues) != 0 || len(store.PlayModes) != 0 {
		t.Errorf("empty values were written: reviews=%v queues=%v play_modes=%v",
			store.Reviews, store.Queues, store.PlayModes)
	}
}

// v1 bundles (builds <= 0.22.x) predate the user layer entirely; they must keep
// importing through the same code path with their sections simply empty.
func TestImport_AcceptsSchemaV1BundleWithNoUserLayer(t *testing.T) {
	store := dbtest.New()
	payload := payloadWithData(t, map[string]any{
		"schema":    dataSchemaV1,
		"summaries": []map[string]any{{"Filename": "a.png", "MatchKey": "m1"}},
	})
	summary, err := bundle.Import(store, payload)
	if err != nil {
		t.Fatalf("v1 bundle must still import: %v", err)
	}
	if summary.Imported != 1 || len(store.Summaries) != 1 {
		t.Fatalf("summary = %+v, rows = %d", summary, len(store.Summaries))
	}
	if len(store.UserMatchData) != 0 || len(store.Annotations) != 0 {
		t.Error("a v1 bundle has no user layer to write")
	}
}
