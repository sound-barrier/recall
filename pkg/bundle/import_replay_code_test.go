package bundle_test

import (
	"errors"
	"testing"

	"recall/pkg/bundle"
	"recall/pkg/db"
)

// A replay code names one match: the database holds each at most once. An
// import whose annotation carries a code the database already holds used
// to fail half-way, after the bundle's screenshots had been written. A retry
// then skipped those matches as already present, so their notes, tags and
// reviews never arrived. The conflict is now found before anything is
// written.
func TestImport_AReplayCodeAlreadyTakenIsRefusedBeforeAnyWrite(t *testing.T) {
	store, err := db.NewSQLStore(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	if err := store.SetAnnotation(db.Annotation{MatchKey: "m0", ReplayCode: "ABC123"}); err != nil {
		t.Fatal(err)
	}

	data := map[string]any{
		"schema":      dataSchema,
		"summaries":   []map[string]any{{"Filename": "s.png", "MatchKey": "m1"}},
		"annotations": []map[string]any{{"MatchKey": "m1", "Note": "kept my ult", "ReplayCode": "abc123"}},
	}
	_, err = bundle.Import(store, payloadWithData(t, data))
	if !errors.Is(err, bundle.ErrImportReplayCodeTaken) {
		t.Fatalf("Import = %v, want ErrImportReplayCodeTaken", err)
	}

	files, err := store.LoadAllFilenames()
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 0 {
		t.Errorf("the refused import wrote %d screenshot row(s); want none", len(files))
	}
}

// Two matches in one bundle cannot share a code either.
func TestImport_ABundleRepeatingAReplayCodeIsRefused(t *testing.T) {
	store, err := db.NewSQLStore(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })

	data := map[string]any{
		"schema": dataSchema,
		"annotations": []map[string]any{
			{"MatchKey": "m1", "ReplayCode": "ABC123"},
			{"MatchKey": "m2", "ReplayCode": "ABC123"},
		},
	}
	if _, err := bundle.Import(store, payloadWithData(t, data)); !errors.Is(err, bundle.ErrImportReplayCodeTaken) {
		t.Fatalf("Import = %v, want ErrImportReplayCodeTaken", err)
	}
}
