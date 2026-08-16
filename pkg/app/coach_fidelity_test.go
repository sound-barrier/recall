package app_test

import (
	"reflect"
	"testing"

	"recall/pkg/app"
	"recall/pkg/db"
	"recall/pkg/db/dbtest"
	"recall/pkg/match"
)

// THE fidelity guarantee: the records a session renders in memory are the
// records the app would show if the same bundle had been imported into a
// real database — same aggregation, same user layer, same inference. If the
// two ever drift, the coach is reviewing something the player never played.

// bundleParsedAt is the parsed_at each OCR row carries out of the player's
// export, which the session preserves verbatim.
var bundleParsedAt = map[string]string{
	playerMatchRialto: "2026-05-10T22:06:00Z",
	playerMatchIlios:  "2026-05-11T10:20:00Z",
}

func TestCoachSession_FidelityWithStoreBackedImport(t *testing.T) {
	isolateInstall(t)
	payload := plainBundle(t)

	loaned := sessionRecords(t, payload)
	stored := importedRecords(t, payload)

	if len(loaned) != len(stored) {
		t.Fatalf("record counts differ: session %d, store-backed %d", len(loaned), len(stored))
	}
	assertServerStampDeparture(t, loaned, stored)
	blankDocumentedDepartures(loaned)
	blankDocumentedDepartures(stored)

	for i := range loaned {
		if !reflect.DeepEqual(loaned[i], stored[i]) {
			t.Errorf("record %d (%s) differs\nsession:     %+v\nstore-backed: %+v",
				i, loaned[i].MatchKey, loaned[i], stored[i])
		}
	}
}

// sessionRecords is path (a): the bundle opened as a coaching session and
// read back off the App, with no store in the picture.
func sessionRecords(t *testing.T, payload []byte) []match.Record {
	t.Helper()
	a := app.NewWithStore(dbtest.New())
	if _, err := a.OpenCoachSession(payload); err != nil {
		t.Fatalf("OpenCoachSession: %v", err)
	}
	recs, err := a.GetCoachSessionMatches()
	mustNoErr(t, err)
	return recs
}

// importedRecords is path (b): the same bundle merged into a fresh SQLite
// database and read back through the ordinary read path.
func importedRecords(t *testing.T, payload []byte) []match.Record {
	t.Helper()
	store, err := db.NewSQLStore(":memory:")
	mustNoErr(t, err)
	t.Cleanup(func() { _ = store.Close() })
	a := app.NewWithStore(store)
	outcome, err := a.ImportMatches(payload)
	mustNoErr(t, err)
	if outcome.Imported != 3 {
		t.Fatalf("Imported = %d, want the fixture's 3 matches", outcome.Imported)
	}
	recs, err := a.GetMatchResults()
	mustNoErr(t, err)
	return recs
}

// blankDocumentedDepartures erases the three fields the two paths are
// allowed to disagree on:
//
//  1. ThumbnailFile — a session never resolves a screenshot against the
//     coach's disk (design rule 8), so it is always empty there.
//  2. SourceDirIDs — a bundle carries no screenshots_dirs, so an import
//     remaps every row onto the "dir unset" sentinel while the session
//     blanks the map outright.
//  3. The server-stamped timestamps — see assertServerStampDeparture.
func blankDocumentedDepartures(recs []match.Record) {
	for i := range recs {
		recs[i].ThumbnailFile = ""
		recs[i].SourceDirIDs = nil
		recs[i].ParsedAt = ""
		recs[i].SourceParsedAt = nil
		recs[i].ReviewedAt = ""
		if recs[i].Annotation != nil {
			recs[i].Annotation.AnnotatedAt = ""
		}
	}
}

// assertServerStampDeparture pins the third difference — and its direction,
// because it is NOT the session's doing. A merge import re-stamps every
// server-side timestamp with the import clock (the parent UPSERT leaves
// parsed_at to its column DEFAULT; SetReview / SetAnnotation stamp "now"),
// while a session preserves what the bundle carried. The session is the
// FAITHFUL side. If bundle import is ever taught to preserve them, this
// test fails and the normalization above should be deleted with it.
func assertServerStampDeparture(t *testing.T, loaned, stored []match.Record) {
	t.Helper()
	for i := range loaned {
		want, ocr := bundleParsedAt[loaned[i].MatchKey]
		if !ocr {
			continue
		}
		if loaned[i].ParsedAt != want {
			t.Errorf("session %s parsed_at = %q, want the bundle's %q", loaned[i].MatchKey, loaned[i].ParsedAt, want)
		}
		if stored[i].ParsedAt == want {
			t.Errorf("store-backed %s parsed_at = %q — the import now preserves it; "+
				"drop parsed_at from blankDocumentedDepartures", stored[i].MatchKey, stored[i].ParsedAt)
		}
	}
}
