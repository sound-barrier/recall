package db_test

import (
	"testing"
	"time"

	"recall/pkg/db"
)

// Who owns the clock on a server-assigned timestamp. A parse leaves parsed_at
// to the store, but a restore replays the instant its bundle carried —
// otherwise re-importing your own backup rewrites when everything happened.
// Both Store implementations must agree, since the Fake stands in for
// SQLStore across the app and handler tests.

// parentTableCount is the number of parent screenshot tables every
// parsed_at assertion below sweeps.
const parentTableCount = 5

// upsertEveryParent writes one row into each parent table, all sharing a
// match and a parsed_at, so a stamp assertion covers all five tables without
// five copies of itself. The filenames are fixed, so calling it twice is the
// re-parse of the same five screenshots.
func upsertEveryParent(t *testing.T, s db.Store, parsedAt string) {
	t.Helper()
	const key = "match-2026-01-01T12-00-00"
	mustNoErr(t, s.UpsertSummary(db.SummaryRow{Filename: "summary.png", MatchKey: key, ParsedAt: parsedAt}))
	mustNoErr(t, s.UpsertTeams(db.TeamsRow{Filename: "teams.png", MatchKey: key, ParsedAt: parsedAt}))
	mustNoErr(t, s.UpsertPersonal(db.PersonalRow{Filename: "personal.png", MatchKey: key, ParsedAt: parsedAt}))
	mustNoErr(t, s.UpsertRank(db.RankRow{Filename: "rank.png", MatchKey: key, ParsedAt: parsedAt}))
	mustNoErr(t, s.UpsertUnknown(db.UnknownRow{Filename: "unknown.png", MatchKey: key, ParsedAt: parsedAt}))
}

// collectStamps folds one parent table's rows into a filename → parsed_at map.
func collectStamps[T any](out map[string]string, rows []T, get func(T) (filename, parsedAt string)) {
	for _, r := range rows {
		f, at := get(r)
		out[f] = at
	}
}

// parsedAtByFilename reads every parent row back. It fails when a table is
// missing so no sweep below can pass vacuously.
func parsedAtByFilename(t *testing.T, s db.Store) map[string]string {
	t.Helper()
	snap, err := s.LoadAll()
	mustNoErr(t, err)
	out := map[string]string{}
	collectStamps(out, snap.Summaries, func(r db.SummaryRow) (string, string) { return r.Filename, r.ParsedAt })
	collectStamps(out, snap.Teams, func(r db.TeamsRow) (string, string) { return r.Filename, r.ParsedAt })
	collectStamps(out, snap.Personals, func(r db.PersonalRow) (string, string) { return r.Filename, r.ParsedAt })
	collectStamps(out, snap.Ranks, func(r db.RankRow) (string, string) { return r.Filename, r.ParsedAt })
	collectStamps(out, snap.Unknowns, func(r db.UnknownRow) (string, string) { return r.Filename, r.ParsedAt })
	if len(out) != parentTableCount {
		t.Fatalf("read back %d parent rows, want one per parent table", len(out))
	}
	return out
}

// A restore supplies the instant the row was originally parsed at, and the
// store must write it as given — the bundle import is the caller, and the
// whole point of restoring a backup is that it does not rewrite history.
func TestStoreContract_ParentUpsertKeepsASuppliedParsedAt(t *testing.T) {
	const supplied = "2026-05-10T22:06:00Z"
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			upsertEveryParent(t, s, supplied)
			for filename, at := range parsedAtByFilename(t, s) {
				if at != supplied {
					t.Errorf("%s parsed_at = %q, want the supplied %q", filename, at, supplied)
				}
			}
		})
	}
}

// assertServerStamped fails unless the store filled the instant in itself.
func assertServerStamped(t *testing.T, what, got string) {
	t.Helper()
	if _, err := time.Parse(time.RFC3339, got); err != nil {
		t.Errorf("%s = %q, want a server RFC3339 stamp: %v", what, got, err)
	}
}

// The parse path supplies nothing, and the store stamps for it — an empty
// parsed_at is "you own this one", not a value to store verbatim.
func TestStoreContract_ParentUpsertStampsAnEmptyParsedAt(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			upsertEveryParent(t, s, "")
			for filename, at := range parsedAtByFilename(t, s) {
				assertServerStamped(t, filename+" parsed_at", at)
			}
		})
	}
}

// A re-parse rewrites every scalar on the row but must leave parsed_at at the
// first-insert instant: it answers "when did this screenshot enter the
// database", which a second OCR run does not change.
func TestStoreContract_ParentUpsertKeepsTheFirstInsertParsedAtOnReParse(t *testing.T) {
	const first = "2026-05-10T22:06:00Z"
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			upsertEveryParent(t, s, first)
			upsertEveryParent(t, s, "2027-09-30T08:00:00Z")
			for filename, at := range parsedAtByFilename(t, s) {
				if at != first {
					t.Errorf("%s parsed_at = %q after a re-parse, want the first-insert %q", filename, at, first)
				}
			}
		})
	}
}

// The review sidecar splits the same way: SetReviewAt is the restore path and
// replays the instant the bundle carried, an empty one still falls to the
// server clock.
func TestStoreContract_ReviewKeepsTheInstantARestoreSupplies(t *testing.T) {
	const restored, fresh = "match-2026-01-01T12-00-00", "match-2026-01-02T12-00-00"
	const supplied = "2026-05-11T09:00:00Z"
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			mustNoErr(t, s.SetReviewAt(restored, "coach", supplied))
			mustNoErr(t, s.SetReviewAt(fresh, "self", ""))
			reviews, err := s.LoadReviews()
			mustNoErr(t, err)
			if got := reviews[restored]; got.ReviewedBy != "coach" || got.ReviewedAt != supplied {
				t.Errorf("restored review = %+v, want coach at the supplied %q", got, supplied)
			}
			assertServerStamped(t, "SetReviewAt with no instant", reviews[fresh].ReviewedAt)
		})
	}
}

// SetAnnotationAt is the annotation's restore path; the instant rides in the
// row's own AnnotatedAt.
func TestStoreContract_AnnotationKeepsTheInstantARestoreSupplies(t *testing.T) {
	const restored, fresh = "match-2026-01-01T12-00-00", "match-2026-01-02T12-00-00"
	const supplied = "2026-05-11T09:05:00Z"
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			mustNoErr(t, s.SetAnnotationAt(db.Annotation{MatchKey: restored, Note: "held the point", AnnotatedAt: supplied}))
			mustNoErr(t, s.SetAnnotationAt(db.Annotation{MatchKey: fresh, Note: "no instant carried"}))
			annotations, err := s.LoadAnnotations()
			mustNoErr(t, err)
			if got := annotations[restored].AnnotatedAt; got != supplied {
				t.Errorf("restored annotated_at = %q, want the supplied %q", got, supplied)
			}
			assertServerStamped(t, "SetAnnotationAt with no instant", annotations[fresh].AnnotatedAt)
		})
	}
}

// A hand-entered match exists only as its override row, and the aggregator
// reads user_match_data.updated_at as that match's parsed_at — so a restore
// that re-stamps it moves every manual match to the day it was imported. No
// live caller supplies the instant, which is why this one setter serves both
// paths.
func TestStoreContract_UserMatchDataKeepsTheInstantARestoreSupplies(t *testing.T) {
	const restored, fresh = "match-2026-01-01T12-00-00", "match-2026-01-02T12-00-00"
	const supplied = "2026-05-11T09:10:00Z"
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			mustNoErr(t, s.UpsertUserMatchData(db.UserMatchData{
				MatchKey: restored, Map: new("busan"), UpdatedAt: supplied,
			}))
			mustNoErr(t, s.UpsertUserMatchData(db.UserMatchData{MatchKey: fresh, Map: new("busan")}))
			all, err := s.LoadAllUserMatchData()
			mustNoErr(t, err)
			if got := all[restored].UpdatedAt; got != supplied {
				t.Errorf("restored updated_at = %q, want the supplied %q", got, supplied)
			}
			assertServerStamped(t, "UpsertUserMatchData with no instant", all[fresh].UpdatedAt)
		})
	}
}

// A live edit's instant is the store's to assign, whatever the caller hands
// it: the editor round-trips the annotation it loaded, so honoring the
// carried AnnotatedAt would leave a note edited today reading as untouched
// since the day it was written.
func TestStoreContract_LiveAnnotationStampsOverACarriedInstant(t *testing.T) {
	const key, stale = "match-2026-01-01T12-00-00", "2020-01-01T00:00:00Z"
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			mustNoErr(t, s.SetAnnotation(db.Annotation{MatchKey: key, Note: "edited just now", AnnotatedAt: stale}))
			annotations, err := s.LoadAnnotations()
			mustNoErr(t, err)
			got := annotations[key].AnnotatedAt
			if got == stale {
				t.Errorf("annotated_at = %q — a live edit kept the instant it was handed", got)
			}
			assertServerStamped(t, "SetAnnotation", got)
		})
	}
}

// Re-marking a match reviewed is a live edit too, so its instant moves. The
// Fake used to keep whatever stamp was already there, which let tests observe
// a "reviewed_at frozen in the past" state the real store cannot produce —
// the kind of corner-cutting that makes a fake a broken fake rather than a
// shortcut.
func TestStoreContract_LiveReviewRestampsAnExistingRow(t *testing.T) {
	const key, first = "match-2026-02-02T12-00-00", "2020-01-01T00:00:00Z"
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			mustNoErr(t, s.SetReviewAt(key, "self", first))
			mustNoErr(t, s.SetReview(key, "coach"))

			reviews, err := s.LoadReviews()
			mustNoErr(t, err)
			got := reviews[key].ReviewedAt
			if got == first {
				t.Errorf("reviewed_at = %q — re-marking kept the original instant", got)
			}
			assertServerStamped(t, "SetReview", got)
		})
	}
}

// A coach block carries the instant the player accepted it. A restore must
// bring that back rather than claiming every note was accepted at import
// time — the same rule the parent tables and the review/annotation layers
// follow.
func TestStoreContract_CoachNoteKeepsTheInstantARestoreSupplies(t *testing.T) {
	const key, accepted = "match-2026-03-03T12-00-00", "2026-03-04T09:30:00Z"
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			_, err := s.UpsertMatchCoachNote(db.MatchCoachNote{
				NoteID: "9f8e7d6c-5b4a-4392-8271-0f1e2d3c4b5a", MatchKey: key,
				CoachName: "Ordo", SessionDate: "2026-03-04", Text: "hold the high ground",
				AcceptedAt: accepted,
			})
			mustNoErr(t, err)

			blocks, err := s.LoadMatchCoachNotes()
			mustNoErr(t, err)
			if len(blocks[key]) != 1 {
				t.Fatalf("got %d blocks on %s, want 1", len(blocks[key]), key)
			}
			if got := blocks[key][0].AcceptedAt; got != accepted {
				t.Errorf("accepted_at = %q, want the supplied %q", got, accepted)
			}
		})
	}
}

// …and a live accept, which carries no instant, is stamped by the store.
func TestStoreContract_CoachNoteStampsAnEmptyAcceptedAt(t *testing.T) {
	const key = "match-2026-03-05T12-00-00"
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			_, err := s.UpsertMatchCoachNote(db.MatchCoachNote{
				NoteID: "1a2b3c4d-5e6f-4718-9203-abcdefabcdef", MatchKey: key,
				CoachName: "Ordo", SessionDate: "2026-03-05", Text: "peel earlier",
			})
			mustNoErr(t, err)

			blocks, err := s.LoadMatchCoachNotes()
			mustNoErr(t, err)
			assertServerStamped(t, "UpsertMatchCoachNote", blocks[key][0].AcceptedAt)
		})
	}
}
