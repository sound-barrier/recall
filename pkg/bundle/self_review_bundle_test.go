package bundle_test

import (
	"slices"
	"testing"

	"recall/pkg/bundle"
	"recall/pkg/db"
	"recall/pkg/db/dbtest"
)

// A self-review sitting travels in the bundle WHOLE under its own UUID —
// members, notes, moments, instants — narrowed to the keys the bundle
// carries. What must hold on both ends: a sitting with no included member
// stays home; a partly-included one travels over the included part; an
// import creates it iff its UUID is absent, over the keys it is bringing in,
// and drops it whole rather than leave an orphan block; a re-import doubles
// nothing.

const (
	sittingID        = "d3b07384-d9a0-4c8e-9a1f-1234567890ab"
	sittingCreatedAt = "2026-05-14T18:00:00Z"
	sittingUpdatedAt = "2026-05-14T18:30:00Z"
	sittingNoteAt    = "2026-05-14T18:10:00Z"
	sittingMomentAt  = "2026-05-14T18:12:00Z"
)

// seedSitting puts one sitting over m1 + m2 (a note with a moment on each)
// and a second sitting over m3 alone on the store.
func seedSitting(t *testing.T, s db.Store) {
	t.Helper()
	if _, err := s.CreateSelfReview(db.SelfReview{
		ReviewID: sittingID, Title: "May sitting", Summary: "Hold nade.",
		CreatedAt: sittingCreatedAt, UpdatedAt: sittingUpdatedAt, MatchKeys: []string{"m2", "m1"},
	}); err != nil {
		t.Fatalf("seed sitting: %v", err)
	}
	for _, k := range []string{"m1", "m2"} {
		if _, err := s.UpsertSelfReviewNote(db.SelfReviewNote{
			ReviewID: sittingID, MatchKey: k, Kind: "note", Text: "note on " + k, FocusTags: []string{"cooldowns"},
			CreatedAt: sittingNoteAt, UpdatedAt: sittingNoteAt,
		}); err != nil {
			t.Fatalf("seed note: %v", err)
		}
		if _, err := s.UpsertSelfReviewMoment(sittingID, k, db.SelfReviewMoment{
			MomentID: "moment-" + k, MatchClock: "06:40", Text: "at " + k, CreatedAt: sittingMomentAt, UpdatedAt: sittingMomentAt,
		}); err != nil {
			t.Fatalf("seed moment: %v", err)
		}
	}
	if _, err := s.CreateSelfReview(db.SelfReview{ReviewID: "other-sitting", MatchKeys: []string{"m3"}}); err != nil {
		t.Fatalf("seed other sitting: %v", err)
	}
}

// exportSitting seeds the sitting on a fresh store and exports the bundle
// over keys.
func exportSitting(t *testing.T, keys ...string) []byte {
	t.Helper()
	shots := t.TempDir()
	src := seededStore(t, shots)
	writeShots(t, shots, seededParentFiles()...)
	seedSitting(t, src)
	payload, err := bundle.Export(src, bundle.ExportBundleOptions{MatchKeys: keys}, nil, shots, seededVersion)
	if err != nil {
		t.Fatalf("Export: %v", err)
	}
	return payload
}

func importInto(t *testing.T, dst db.Store, payload []byte) {
	t.Helper()
	if _, err := bundle.Import(dst, payload); err != nil {
		t.Fatalf("Import: %v", err)
	}
}

// importedPair exports the sitting over m1 + m2 and imports it once into an
// empty SQL store — the real schema, so the instants round-trip through
// the columns that hold them.
func importedPair(t *testing.T) ([]byte, db.Store) {
	t.Helper()
	payload := exportSitting(t, "m1", "m2")
	dst, err := db.NewSQLStore(":memory:")
	if err != nil {
		t.Fatalf("NewSQLStore: %v", err)
	}
	t.Cleanup(func() { _ = dst.Close() })
	importInto(t, dst, payload)
	return payload, dst
}

// holdMatches puts a summary row for each key on s, so an import sees the
// match as already here — its rows, and by the section rule, its user layer.
func holdMatches(t *testing.T, s db.Store, keys ...string) {
	t.Helper()
	for _, k := range keys {
		if err := s.UpsertSummary(db.SummaryRow{Filename: k + ".png", MatchKey: k, Map: "ilios"}); err != nil {
			t.Fatal(err)
		}
	}
}

func assertMembers(t *testing.T, got db.SelfReview, want ...string) {
	t.Helper()
	if !slices.Equal(got.MatchKeys, want) {
		t.Errorf("members = %v, want %v", got.MatchKeys, want)
	}
}

func TestExport_CarriesASittingOverItsIncludedKeysOnly(t *testing.T) {
	d := exportedData(t, exportSitting(t, "m1"))
	if len(d.SelfReviews) != 1 {
		t.Fatalf("self_reviews = %+v, want the one sitting that touches m1 (the m3-only sitting stays home)", d.SelfReviews)
	}
	got := d.SelfReviews[0]
	if got.ReviewID != sittingID || got.Title != "May sitting" || got.Summary != "Hold nade." || got.CreatedAt != sittingCreatedAt {
		t.Errorf("sitting header = %+v", got)
	}
	// Narrowed to the included m1.
	assertMembers(t, got, "m1")
	if len(got.Notes) != 1 || got.Notes["m1"].Text != "note on m1" || len(got.Notes["m1"].Moments) != 1 {
		t.Errorf("notes = %+v, want only m1's note with its moment", got.Notes)
	}
}

func TestImport_CreatesTheSittingUnderItsOwnIDWithItsInstants(t *testing.T) {
	_, dst := importedPair(t)
	got, ok, err := dst.LoadSelfReview(sittingID)
	if err != nil || !ok {
		t.Fatalf("LoadSelfReview after import: ok=%v err=%v", ok, err)
	}
	if got.CreatedAt != sittingCreatedAt || got.UpdatedAt != sittingUpdatedAt || got.Title != "May sitting" {
		t.Errorf("sitting after import = %+v, want the bundle's own instants and title", got)
	}
	// The player's order kept.
	assertMembers(t, got, "m2", "m1")
	note := got.Notes["m1"]
	if note.CreatedAt != sittingNoteAt || len(note.Moments) != 1 || note.Moments[0].CreatedAt != sittingMomentAt {
		t.Errorf("note after import = %+v, want its instants and moment kept", note)
	}
	if reviews, _ := dst.LoadSelfReviews(); len(reviews) != 1 {
		t.Errorf("the m3-only sitting was not in the bundle yet %d sittings landed", len(reviews))
	}
}

// Importing the same bundle again doubles nothing.
func TestImport_ReimportOfASittingDoublesNothing(t *testing.T) {
	payload, dst := importedPair(t)
	importInto(t, dst, payload)
	reviews, _ := dst.LoadSelfReviews()
	byMatch, _ := dst.LoadSelfReviewNotes()
	if len(reviews) != 1 || len(byMatch["m1"]) != 1 || len(byMatch["m1"][0].Moments) != 1 {
		t.Errorf("after re-import: %d sittings, m1 blocks = %+v; want one of each", len(reviews), byMatch["m1"])
	}
}

// A sitting over keys the target already holds is narrowed to the keys the
// import brings in — never left as an orphan block on a match the import
// did not touch.
func TestImport_NarrowsASittingToTheKeysItBringsIn(t *testing.T) {
	payload := exportSitting(t, "m1", "m2")
	dst := dbtest.New()
	holdMatches(t, dst, "m1")
	importInto(t, dst, payload)
	got, ok, _ := dst.LoadSelfReview(sittingID)
	if !ok {
		t.Fatal("the sitting was dropped though m2 was fresh")
	}
	assertMembers(t, got, "m2")
	if len(got.Notes) != 1 {
		t.Errorf("sitting = %+v, want narrowed to m2", got)
	}
	byMatch, _ := dst.LoadSelfReviewNotes()
	if len(byMatch["m1"]) != 0 {
		t.Errorf("an import wrote a block onto a match it did not bring in: %+v", byMatch["m1"])
	}
}

// When nothing survives the narrowing the sitting is dropped whole.
func TestImport_DropsASittingWithNoFreshMember(t *testing.T) {
	payload := exportSitting(t, "m1", "m2")
	full := dbtest.New()
	holdMatches(t, full, "m1", "m2")
	importInto(t, full, payload)
	if reviews, _ := full.LoadSelfReviews(); len(reviews) != 0 {
		t.Errorf("a sitting with no fresh member was created: %+v", reviews)
	}
}

// A sitting the target already holds under the bundle's UUID is left alone
// even when the bundle would bring in a fresh member for it: the local copy
// is the player's, and writing the bundle's over it would hit the same
// review_id. The rest of the import (m2's rows) still lands.
func TestImport_LeavesAnExistingSittingAloneWhenAMemberIsFresh(t *testing.T) {
	payload := exportSitting(t, "m1", "m2")
	dst, err := db.NewSQLStore(":memory:")
	if err != nil {
		t.Fatalf("NewSQLStore: %v", err)
	}
	t.Cleanup(func() { _ = dst.Close() })
	holdMatches(t, dst, "m1")
	if _, err := dst.CreateSelfReview(db.SelfReview{ReviewID: sittingID, Title: "already here", MatchKeys: []string{"m1"}}); err != nil {
		t.Fatalf("seed local sitting: %v", err)
	}

	importInto(t, dst, payload)

	got, ok, err := dst.LoadSelfReview(sittingID)
	if err != nil || !ok {
		t.Fatalf("LoadSelfReview after import: ok=%v err=%v", ok, err)
	}
	if got.Title != "already here" || len(got.Notes) != 0 {
		t.Errorf("the local sitting was rewritten by the import: %+v", got)
	}
	assertMembers(t, got, "m1")
	if keys, _ := dst.LoadMatchKeys(); !keys["m2"] {
		t.Error("m2's rows did not land though the sitting was skipped")
	}
}

// A sitting or a moment without its id cannot be keyed and would be refused
// by the store mid-import; it is named up front, before anything is written.
func TestImport_RejectsASittingOrMomentWithoutItsID(t *testing.T) {
	cases := []struct {
		name    string
		sitting map[string]any
		wantMsg string
	}{
		{"missing review_id", map[string]any{"ReviewID": "", "MatchKeys": []string{"m1"}},
			"import: self_reviews[0] missing required review_id"},
		{"missing moment_id", map[string]any{
			"ReviewID": "r-1", "MatchKeys": []string{"m1"},
			"Notes": map[string]any{"m1": map[string]any{
				"MatchKey": "m1", "Kind": "note", "Text": "x",
				"Moments": []map[string]any{{"MomentID": "", "MatchClock": "01:00", "Text": "y"}},
			}},
		}, `import: self_reviews[0] note "m1" moments[0] missing required moment_id`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := dbtest.New()
			payload := payloadWithData(t, map[string]any{
				"schema":       dataSchemaV2,
				"summaries":    []map[string]any{{"Filename": "a.png", "MatchKey": "m1"}},
				"self_reviews": []map[string]any{tc.sitting},
			})
			_, err := bundle.Import(store, payload)
			if err == nil || err.Error() != tc.wantMsg {
				t.Fatalf("err = %v, want %q", err, tc.wantMsg)
			}
			if store.UpsertCalls != 0 || len(store.SelfReviews) != 0 {
				t.Error("rows were written before the bad sitting was found; a rejected bundle must not half-import")
			}
		})
	}
}

// A member with no note travels as a member: the sitting comes back over
// both keys with the one note it had.
func TestRoundTrip_CarriesAMemberWithNoNote(t *testing.T) {
	shots := t.TempDir()
	src := seededStore(t, shots)
	writeShots(t, shots, seededParentFiles()...)
	const halfNoted = "half-noted"
	if _, err := src.CreateSelfReview(db.SelfReview{ReviewID: halfNoted, MatchKeys: []string{"m1", "m2"}}); err != nil {
		t.Fatalf("seed sitting: %v", err)
	}
	if _, err := src.UpsertSelfReviewNote(db.SelfReviewNote{ReviewID: halfNoted, MatchKey: "m1", Kind: "note", Text: "only on m1"}); err != nil {
		t.Fatalf("seed note: %v", err)
	}
	payload, err := bundle.Export(src, bundle.ExportBundleOptions{MatchKeys: []string{"m1", "m2"}}, nil, shots, seededVersion)
	if err != nil {
		t.Fatalf("Export: %v", err)
	}
	dst, err := db.NewSQLStore(":memory:")
	if err != nil {
		t.Fatalf("NewSQLStore: %v", err)
	}
	t.Cleanup(func() { _ = dst.Close() })
	importInto(t, dst, payload)

	got, ok, err := dst.LoadSelfReview(halfNoted)
	if err != nil || !ok {
		t.Fatalf("LoadSelfReview after import: ok=%v err=%v", ok, err)
	}
	assertMembers(t, got, "m1", "m2")
	if len(got.Notes) != 1 || got.Notes["m1"].Text != "only on m1" {
		t.Errorf("notes after import = %+v, want m1's note alone", got.Notes)
	}
}
