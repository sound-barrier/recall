package bundle_test

import (
	"testing"

	"recall/pkg/bundle"
	"recall/pkg/db"
	"recall/pkg/db/dbtest"
)

// Restoring your own backup must not rewrite when things happened. Every
// server-assigned instant a bundle carries — parsed_at on each screenshot
// row, reviewed_at, annotated_at — has to land on the other side unchanged.
// The import writes into a real SQLite store here because that is where the
// instants were lost: the parent INSERT left parsed_at to its column DEFAULT,
// and the review / annotation setters stamped "now".

const (
	stampedKey         = "match-2026-05-10T22-00-00"
	stampedReviewedAt  = "2026-05-11T09:00:00Z"
	stampedAcceptedAt  = "2026-05-11T10:15:00Z"
	stampedNoteID      = "7c6b5a49-3827-4160-9d5e-4f3a2b1c0d9e"
	stampedAnnotatedAt = "2026-05-11T09:05:00Z"
)

// stampedParentFiles maps each parent row's filename to the parsed_at it
// carries. The five differ so a mis-bound placeholder shows up as a swap
// rather than passing on a shared value.
func stampedParentFiles() map[string]string {
	return map[string]string{
		"summary.png":  "2026-05-10T22:06:00Z",
		"teams.png":    "2026-05-10T22:07:00Z",
		"personal.png": "2026-05-10T22:08:00Z",
		"rank.png":     "2026-05-10T22:09:00Z",
		"unknown.png":  "2026-05-10T22:10:00Z",
	}
}

// stampedStore is one match spread across all five parent tables, plus the
// review and annotation sidecars — each row carrying an instant of its own.
func stampedStore() *dbtest.Fake {
	f := dbtest.New()
	at := stampedParentFiles()
	f.Summaries = []db.SummaryRow{{
		ID: 1, Filename: "summary.png", MatchKey: stampedKey, ParsedAt: at["summary.png"],
		Map: "ilios", Result: "victory",
	}}
	f.Teams = []db.TeamsRow{{
		ID: 2, Filename: "teams.png", MatchKey: stampedKey, ParsedAt: at["teams.png"], Eliminations: 21,
	}}
	f.Personals = []db.PersonalRow{{
		ID: 3, Filename: "personal.png", MatchKey: stampedKey, ParsedAt: at["personal.png"], Hero: "ana",
	}}
	f.Ranks = []db.RankRow{{
		ID: 4, Filename: "rank.png", MatchKey: stampedKey, ParsedAt: at["rank.png"], Rank: "diamond", Level: 3,
	}}
	f.Unknowns = []db.UnknownRow{{
		ID: 5, Filename: "unknown.png", MatchKey: stampedKey, ParsedAt: at["unknown.png"],
	}}
	f.Reviews = map[string]db.ReviewState{stampedKey: {ReviewedBy: "coach", ReviewedAt: stampedReviewedAt}}
	// The received coach layer carries its own instant: WHEN the player
	// accepted the block, which a restore must bring back too.
	f.MatchCoachNotes = []db.MatchCoachNote{{
		ID: 1, NoteID: stampedNoteID, MatchKey: stampedKey, CoachName: "Ordo",
		SessionDate: "2026-05-11", Text: "hold the high ground", AcceptedAt: stampedAcceptedAt,
	}}
	f.Annotations = map[string]db.Annotation{
		stampedKey: {MatchKey: stampedKey, Note: "held the point", AnnotatedAt: stampedAnnotatedAt},
	}
	return f
}

func TestImport_PreservesEveryInstantTheBundleCarries(t *testing.T) {
	payload, err := bundle.Export(stampedStore(),
		bundle.ExportBundleOptions{MatchKeys: []string{stampedKey}}, nil, t.TempDir(), seededVersion)
	if err != nil {
		t.Fatalf("Export: %v", err)
	}
	dst, err := db.NewSQLStore(":memory:")
	if err != nil {
		t.Fatalf("NewSQLStore(:memory:): %v", err)
	}
	t.Cleanup(func() { _ = dst.Close() })

	summary, err := bundle.Import(dst, payload)
	if err != nil {
		t.Fatalf("Import: %v", err)
	}
	if summary.Imported != 1 {
		t.Fatalf("summary = %+v, want the fixture's single match imported", summary)
	}
	assertParsedAtSurvived(t, dst)
	assertSidecarInstantsSurvived(t, dst)

	blocks, err := dst.LoadMatchCoachNotes()
	if err != nil {
		t.Fatalf("LoadMatchCoachNotes: %v", err)
	}
	if len(blocks[stampedKey]) != 1 {
		t.Fatalf("got %d coach blocks, want 1", len(blocks[stampedKey]))
	}
	if got := blocks[stampedKey][0].AcceptedAt; got != stampedAcceptedAt {
		t.Errorf("coach block accepted_at = %q, want the bundle's %q", got, stampedAcceptedAt)
	}
}

// collectImportedStamps folds one parent table's rows into a filename →
// parsed_at map.
func collectImportedStamps[T any](out map[string]string, rows []T, get func(T) (filename, parsedAt string)) {
	for _, r := range rows {
		f, at := get(r)
		out[f] = at
	}
}

func assertParsedAtSurvived(t *testing.T, s db.Store) {
	t.Helper()
	snap, err := s.LoadAll()
	if err != nil {
		t.Fatalf("LoadAll: %v", err)
	}
	got := map[string]string{}
	collectImportedStamps(got, snap.Summaries, func(r db.SummaryRow) (string, string) { return r.Filename, r.ParsedAt })
	collectImportedStamps(got, snap.Teams, func(r db.TeamsRow) (string, string) { return r.Filename, r.ParsedAt })
	collectImportedStamps(got, snap.Personals, func(r db.PersonalRow) (string, string) { return r.Filename, r.ParsedAt })
	collectImportedStamps(got, snap.Ranks, func(r db.RankRow) (string, string) { return r.Filename, r.ParsedAt })
	collectImportedStamps(got, snap.Unknowns, func(r db.UnknownRow) (string, string) { return r.Filename, r.ParsedAt })
	for filename, want := range stampedParentFiles() {
		if got[filename] != want {
			t.Errorf("%s parsed_at = %q after the round trip, want the bundle's %q", filename, got[filename], want)
		}
	}
}

func assertSidecarInstantsSurvived(t *testing.T, s db.Store) {
	t.Helper()
	reviews, err := s.LoadReviews()
	if err != nil {
		t.Fatalf("LoadReviews: %v", err)
	}
	if got := reviews[stampedKey]; got.ReviewedBy != "coach" || got.ReviewedAt != stampedReviewedAt {
		t.Errorf("review = %+v, want coach at the bundle's %q", got, stampedReviewedAt)
	}
	annotations, err := s.LoadAnnotations()
	if err != nil {
		t.Fatalf("LoadAnnotations: %v", err)
	}
	if got := annotations[stampedKey]; got.AnnotatedAt != stampedAnnotatedAt {
		t.Errorf("annotated_at = %q after the round trip, want the bundle's %q", got.AnnotatedAt, stampedAnnotatedAt)
	}
}
