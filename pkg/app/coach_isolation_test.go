package app_test

import (
	"errors"
	"reflect"
	"testing"

	"recall/pkg/app"
	"recall/pkg/coach"
	"recall/pkg/db"
	"recall/pkg/db/dbtest"
)

// THE isolation guarantee (design rule 3): a coaching session loans the
// player's records into memory and never writes them anywhere. The coach's
// own database must come out of a full session byte-identical — with one
// deliberate exception, the notes the coach WROTE, which are keyed by
// player and are not match history.

// storeLayers is every layer of a store this test compares before and
// after a session. The coach-authored family (players / notes / summaries)
// is deliberately absent — that is the one thing a session may change, and
// coachWork below pins it separately.
type storeLayers struct {
	Screenshots db.Screenshots
	Filenames   map[string]bool
	MatchKeys   map[string]bool
	UserData    map[string]db.UserMatchData
	Annotations map[string]db.Annotation
	Hidden      map[string]bool
	Pinned      map[string]bool
	Reviews     map[string]db.ReviewState
	Queues      map[string]db.QueueState
	PlayModes   map[string]db.PlayModeState
	Ignored     []db.IgnoredRow
	Ingested    map[string]db.IngestedFile
	Failed      []db.FailedFileRow
	AllHeroes   map[string]bool
	CoachLayer  map[string][]db.MatchCoachNote
	Returns     []db.CoachReturn
	Settings    app.Settings
}

// coachWork is the coach-authored family for one player — the deliberate
// exception to byte-identity.
type coachWork struct {
	Notes map[string]db.CoachNote
	Focus []db.FocusItem
}

// mustGet unwraps a (value, error) store read. Spreading the call —
// mustGet(s.LoadAll()) — is the only shape Go allows, so there is no *T to
// fail through; a store read that errors while snapshotting is a broken
// fixture, and the panic names which one.
func mustGet[T any](v T, err error) T {
	if err != nil {
		panic("coaching snapshot: " + err.Error())
	}
	return v
}

func snapshotLayers(t *testing.T, a *app.App, s db.Store) storeLayers {
	t.Helper()
	return storeLayers{
		Screenshots: mustGet(s.LoadAll()),
		Filenames:   mustGet(s.LoadAllFilenames()),
		MatchKeys:   mustGet(s.LoadMatchKeys()),
		UserData:    mustGet(s.LoadAllUserMatchData()),
		Annotations: mustGet(s.LoadAnnotations()),
		Hidden:      mustGet(s.LoadHiddenKeys()),
		Pinned:      mustGet(s.LoadPinnedKeys()),
		Reviews:     mustGet(s.LoadReviews()),
		Queues:      mustGet(s.LoadMatchQueues()),
		PlayModes:   mustGet(s.LoadMatchPlayModes()),
		Ignored:     mustGet(s.ListIgnoredScreenshots()),
		Ingested:    mustGet(s.LoadIngestedFiles()),
		Failed:      mustGet(s.ListFailedFiles()),
		AllHeroes:   mustGet(s.LoadAllHeroesFilenames()),
		CoachLayer:  mustGet(s.LoadMatchCoachNotes()),
		Returns:     mustGet(s.LoadCoachReturns()),
		Settings:    *app.SettingsOf(a),
	}
}

func snapshotCoachWork(t *testing.T, s db.Store, playerRef int64) coachWork {
	t.Helper()
	focus, err := s.LoadCoachFocusItems(playerRef)
	mustNoErr(t, err)
	return coachWork{Notes: mustGet(s.LoadCoachNotes(playerRef)), Focus: focus}
}

// seedCoachHistory fills the coach's OWN database: their matches, every
// sidecar, the parse-side registries, a coach note they once accepted from
// someone else, and a staged return. The session must leave all of it alone.
func seedCoachHistory(t *testing.T, s db.Store) {
	t.Helper()
	mustNoErr(t, s.UpsertSummary(db.SummaryRow{
		Filename: "coach-own.png", MatchKey: coachOwnMatch, ParsedAt: "2026-05-01T12-00-00Z",
		Map: "hanaoka", Hero: "genji", Result: "victory", Date: "2026-05-01", FinishedAt: "12:00",
	}))
	mustNoErr(t, s.SetAnnotation(db.Annotation{MatchKey: coachOwnMatch, Note: "mine"}))
	mustNoErr(t, s.SetReview(coachOwnMatch, "self"))
	mustNoErr(t, s.SetMatchQueue(coachOwnMatch, "open"))
	mustNoErr(t, s.SetMatchPlayMode(coachOwnMatch, "quickplay"))
	mustNoErr(t, s.HideMatch(coachOwnMatch))
	mustNoErr(t, s.PinMatch(coachOwnMatch))
	mustNoErr(t, s.AddIgnoredScreenshot("junk.png"))
	mustNoErr(t, s.UpsertIngestedFile("coach-own.png", "hash-1", ""))
	mustNoErr(t, s.RecordFailedFile("blurry.png", 0, "no text"))
	mustNoErr(t, s.UpsertAllHeroesScreenshot("all-heroes.png"))
	_, err := s.UpsertMatchCoachNote(db.MatchCoachNote{
		NoteID: "11111111-2222-4333-8444-555555555555", MatchKey: coachOwnMatch,
		CoachName: "Wren", SessionDate: "2026-04-01", Text: "wider angles",
	})
	mustNoErr(t, err)
	_, err = s.InsertCoachReturn(db.CoachReturn{
		ContentHash: "deadbeef", CoachName: "Wren", PlayerHandle: "me",
		SessionDate: "2026-04-01", NotesJSON: []byte(`{"schema":"recall-coach-notes/v1"}`),
	})
	mustNoErr(t, err)
}

// coachOwnMatch is the match in the coach's OWN history.
const coachOwnMatch = "match-2026-05-01T12-00-00"

func TestCoachSession_NeverWritesTheStore(t *testing.T) {
	a, store := coachApp(t)
	seedCoachHistory(t, store)
	before := snapshotLayers(t, a, store)

	if _, err := a.OpenCoachSession(shareBundle(t)); err != nil {
		t.Fatalf("OpenCoachSession: %v", err)
	}
	exerciseSessionSurface(t, a)
	refuseEveryMutation(t, a)
	mustNoErr(t, a.CloseCoachSession())

	after := snapshotLayers(t, a, store)
	if !reflect.DeepEqual(before, after) {
		t.Errorf("a coaching session changed the coach's database\nbefore: %+v\nafter:  %+v", before, after)
	}
}

// The one layer a session DOES change: the coach's own notes about the
// player, which are keyed by player and survive a Clear.
func TestCoachSession_WritesOnlyTheCoachsOwnNotes(t *testing.T) {
	a, store := coachApp(t)
	seedCoachHistory(t, store)
	if _, err := a.OpenCoachSession(shareBundle(t)); err != nil {
		t.Fatalf("OpenCoachSession: %v", err)
	}
	empty := snapshotCoachWork(t, store, 1)
	exerciseSessionSurface(t, a)
	written := snapshotCoachWork(t, store, 1)

	if reflect.DeepEqual(empty, written) {
		t.Fatal("the coach's notes did not change — the session wrote nothing at all")
	}
	note, ok := written.Notes[playerMatchRialto]
	if !ok {
		t.Fatalf("no note stored for %s; got %v", playerMatchRialto, written.Notes)
	}
	if note.Text != writtenNote().Text {
		t.Errorf("stored note text = %q, want %q", note.Text, writtenNote().Text)
	}
	if len(written.Focus) != 1 || written.Focus[0].Text != sessionFocus {
		t.Errorf("stored focus items = %+v, want %q", written.Focus, sessionFocus)
	}
}

const (
	sessionFocus   = "hold high ground longer before committing"
	sessionFocusID = "a1b2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d"
)

// exerciseSessionSurface drives everything a coach does in a session: read
// the view and the reel, write a note, mark one reviewed-only, delete a
// draft, save the summary, and export.
func exerciseSessionSurface(t *testing.T, a *app.App) {
	t.Helper()
	if _, err := a.GetCoachSession(); err != nil {
		t.Fatalf("GetCoachSession: %v", err)
	}
	if _, err := a.GetCoachSessionMatches(); err != nil {
		t.Fatalf("GetCoachSessionMatches: %v", err)
	}
	if _, err := a.PutCoachNote(playerMatchRialto, writtenNote()); err != nil {
		t.Fatalf("PutCoachNote: %v", err)
	}
	if _, err := a.PutCoachNote(playerMatchIlios, coach.NoteInput{Kind: coach.KindReviewedOnly}); err != nil {
		t.Fatalf("PutCoachNote(reviewed_only): %v", err)
	}
	mustNoErr(t, a.DeleteCoachNote(playerMatchIlios))
	mustNoErr(t, a.PutCoachFocusItems([]coach.FocusItem{{ItemID: sessionFocusID, Text: sessionFocus}}))
	if _, _, err := a.ExportCoachNotes(testSheet); err != nil {
		t.Fatalf("ExportCoachNotes: %v", err)
	}
}

// refuseEveryMutation proves the attempts a coach could still make from a
// stale tab all bounce off the gate rather than landing in the store.
func refuseEveryMutation(t *testing.T, a *app.App) {
	t.Helper()
	for name, call := range gatedWrites(a) {
		if err := call(); !errors.Is(err, coach.ErrSessionActive) {
			t.Errorf("%s during a session = %v, want coach.ErrSessionActive", name, err)
		}
	}
}

// A second open is refused while one is active — one session at a time.
func TestCoachSession_SecondOpenIsRefused(t *testing.T) {
	a, _ := openSession(t)
	if _, err := a.OpenCoachSession(shareBundle(t)); !errors.Is(err, coach.ErrSessionActive) {
		t.Errorf("second OpenCoachSession = %v, want coach.ErrSessionActive", err)
	}
}

// Closing is idempotent — the frontend calls it on a stale resume.
func TestCoachSession_CloseIsIdempotent(t *testing.T) {
	isolateInstall(t)
	a := app.NewWithStore(dbtest.New())
	mustNoErr(t, a.CloseCoachSession())
	mustNoErr(t, a.CloseCoachSession())
	if _, err := a.GetCoachSession(); !errors.Is(err, coach.ErrNoSession) {
		t.Errorf("GetCoachSession with none open = %v, want coach.ErrNoSession", err)
	}
}
