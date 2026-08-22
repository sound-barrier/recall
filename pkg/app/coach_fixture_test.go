package app_test

import (
	"encoding/json"
	"testing"

	"recall/pkg/app"
	"recall/pkg/coach"
	"recall/pkg/db"
	"recall/pkg/db/dbtest"
)

// Shared rig for the coaching-session tests. A coaching session is a
// player's exported bundle rendered in the COACH's process, so every test
// here needs two sides: a player's store to export from, and a coach's App
// to open the result in.

// The player's three matches — two OCR-parsed and one hand-entered, so the
// loaned corpus exercises both aggregation paths.
const (
	playerMatchRialto = "match-2026-05-10T22-00-00"
	playerMatchIlios  = "match-2026-05-11T10-00-00"
	playerMatchManual = "match-2026-05-12T20-00-00"
	// playerHandle is the handle a share-mode bundle carries.
	playerHandle = "Sable"
	// coachName is the coach's name in Settings — export refuses without it.
	coachName = "Ordo"
)

// isolateInstall points every install-rooted path (settings.json, the
// profile tree) at throwaway directories so a test never reads or writes
// the developer's real Recall install.
func isolateInstall(t *testing.T) {
	t.Helper()
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
}

// playerCorpus seeds a store with the player's history: two OCR matches
// carrying one of every user layer, plus a hand-entered match that lives
// only in the override layer.
func playerCorpus(store db.Store) error {
	rows := []db.SummaryRow{
		{Filename: "rialto.png", MatchKey: playerMatchRialto, ParsedAt: "2026-05-10T22:06:00Z",
			Map: "rialto", Hero: "ana", Result: "victory", Date: "2026-05-10", FinishedAt: "22:05"},
		{Filename: "ilios.png", MatchKey: playerMatchIlios, ParsedAt: "2026-05-11T10:20:00Z",
			Map: "ilios", Hero: "juno", Result: "defeat", Date: "2026-05-11", FinishedAt: "10:18"},
	}
	for _, r := range rows {
		if err := store.UpsertSummary(r); err != nil {
			return err
		}
	}
	if err := seedPlayerAnnotations(store); err != nil {
		return err
	}
	if err := store.SetReview(playerMatchRialto, "self"); err != nil {
		return err
	}
	if err := store.SetMatchQueue(playerMatchRialto, "role"); err != nil {
		return err
	}
	if err := store.SetMatchPlayMode(playerMatchRialto, "competitive"); err != nil {
		return err
	}
	if err := store.PinMatch(playerMatchIlios); err != nil {
		return err
	}
	if err := seedReviewFamilies(store); err != nil {
		return err
	}
	mapName, hero, result := "dorado", "lucio", "draw"
	return store.UpsertUserMatchData(db.UserMatchData{
		MatchKey: playerMatchManual, Map: &mapName, Hero: &hero, Result: &result,
	})
}

// seedReviewFamilies adds the three review families a corpus can carry, so
// the fidelity test (session records == store-backed import) is a
// completeness gate over every user-layer surface, not just the ones that
// existed first: the player's own moment, a coach's accepted block, and a
// self-review sitting with a note and a moment.
func seedReviewFamilies(store db.Store) error {
	if _, err := store.UpsertMatchMoment(db.MatchMoment{
		MomentID: "player-moment-1", MatchKey: playerMatchRialto, MatchClock: "04:45", Text: "peeled late", FocusTag: "positioning",
	}); err != nil {
		return err
	}
	if _, err := store.UpsertMatchCoachNote(db.MatchCoachNote{
		NoteID: "earlier-coach-note", MatchKey: playerMatchIlios, CoachName: "Vex", SessionDate: "2026-05-12",
		Text: "hold the high ground", FocusTags: []string{"positioning"}, AcceptedAt: "2026-05-13T09:00:00Z",
	}); err != nil {
		return err
	}
	sitting, err := store.CreateSelfReview(db.SelfReview{
		ReviewID: "self-review-1", Title: "May sitting", CreatedAt: "2026-05-14T18:00:00Z", UpdatedAt: "2026-05-14T18:30:00Z",
		MatchKeys: []string{playerMatchRialto, playerMatchIlios},
	})
	if err != nil {
		return err
	}
	if _, err := store.UpsertSelfReviewNote(db.SelfReviewNote{
		ReviewID: sitting.ReviewID, MatchKey: playerMatchRialto, Kind: "note", Text: "my own read",
		FocusTags: []string{"cooldowns"}, CreatedAt: "2026-05-14T18:10:00Z", UpdatedAt: "2026-05-14T18:10:00Z",
	}); err != nil {
		return err
	}
	_, err = store.UpsertSelfReviewMoment(sitting.ReviewID, playerMatchRialto, db.SelfReviewMoment{
		MomentID: "self-moment-1", MatchClock: "06:40", Text: "should have held", CreatedAt: "2026-05-14T18:12:00Z", UpdatedAt: "2026-05-14T18:12:00Z",
	})
	return err
}

// playerBundleOpts is the selection every fixture bundle exports.
func playerBundleOpts() app.ExportBundleOptions {
	return app.ExportBundleOptions{MatchKeys: []string{playerMatchRialto, playerMatchIlios, playerMatchManual}}
}

// plainBundle is the player's history exported the ordinary way — no
// identity in the manifest, so it also imports as match history.
func plainBundle(t *testing.T) []byte {
	t.Helper()
	player := app.NewWithStore(dbtest.New())
	mustNoErr(t, playerCorpus(app.Store(player)))
	payload, err := player.ExportBundle(playerBundleOpts())
	mustNoErr(t, err)
	return payload
}

// shareBundle is the player's history exported to hand to a coach: the
// manifest names them, so a mis-clicked Import refuses it.
func shareBundle(t *testing.T) []byte {
	t.Helper()
	player := app.NewWithStore(dbtest.New())
	mustNoErr(t, playerCorpus(app.Store(player)))
	payload, err := player.ExportShareBundle(playerBundleOpts(),
		app.SharePlayer{Handle: playerHandle, Message: "look at my Ana"})
	mustNoErr(t, err)
	return payload
}

// tamperedShareBundle is a real share bundle whose manifest was hand-edited
// to name an identity no export would have written — the shape a coach can
// be handed but Recall never produces.
func tamperedShareBundle(t *testing.T) []byte {
	t.Helper()
	return modifyBundle(t, shareBundle(t), func(name string, body []byte) (string, []byte, bool) {
		if name != "manifest.json" {
			return "", nil, false
		}
		var mf map[string]any
		if err := json.Unmarshal(body, &mf); err != nil {
			t.Fatalf("decode manifest: %v", err)
		}
		mf["player"] = map[string]any{"id": "not-a-uuid", "handle": playerHandle}
		edited, err := json.Marshal(mf)
		if err != nil {
			t.Fatalf("encode manifest: %v", err)
		}
		return "", edited, false
	})
}

// coachApp is a coach's App on an empty in-memory store, with their name
// already set so export is reachable.
func coachApp(t *testing.T) (*app.App, *dbtest.Fake) {
	t.Helper()
	isolateInstall(t)
	store := dbtest.New()
	a := app.NewWithStore(store)
	if _, err := a.SetCoachingSettings(coachName, ""); err != nil {
		t.Fatalf("SetCoachingSettings: %v", err)
	}
	return a, store
}

// openSession opens the share bundle on a fresh coach App and returns both.
func openSession(t *testing.T) (*app.App, *dbtest.Fake) {
	t.Helper()
	a, store := coachApp(t)
	if _, err := a.OpenCoachSession(shareBundle(t)); err != nil {
		t.Fatalf("OpenCoachSession: %v", err)
	}
	return a, store
}

// playerApp is the PLAYER's side of the loop: their own history in an
// in-memory store, ready to receive a coach's notes back.
func playerApp(t *testing.T) (*app.App, *dbtest.Fake) {
	t.Helper()
	isolateInstall(t)
	store := dbtest.New()
	mustNoErr(t, playerCorpus(store))
	return app.NewWithStore(store), store
}

// notesArchive is what a coach hands back after one session: a single
// written note on the player's Rialto match. Build it BEFORE the player's
// App — it runs a whole coaching session of its own, install isolation
// included.
func notesArchive(t *testing.T) []byte {
	t.Helper()
	a, _ := openSession(t)
	if _, err := a.PutCoachNote(playerMatchRialto, writtenNote()); err != nil {
		t.Fatalf("PutCoachNote: %v", err)
	}
	_, payload, err := a.ExportCoachNotes(testSheet)
	mustNoErr(t, err)
	return payload
}

// writtenNote is the note body the tests write against a loaned match.
func writtenNote() coach.NoteInput {
	return coach.NoteInput{
		Kind:       coach.KindNote,
		Text:       "walk the high ground before the fight opens",
		FocusTags:  []string{"positioning"},
		MatchClock: "6:40",
	}
}

// seedPlayerAnnotations gives every fixture match its journal layer — and a
// replay code on each, because share mode requires one on every match going
// to a coach and these fixtures feed the share tests.
func seedPlayerAnnotations(store db.Store) error {
	annotations := []db.Annotation{
		{MatchKey: playerMatchRialto, Note: "held the point", Tags: []string{"stack"}, ReplayCode: "AB12CD"},
		{MatchKey: playerMatchIlios, ReplayCode: "EF34GH"},
		{MatchKey: playerMatchManual, ReplayCode: "IJ56KL"},
	}
	for _, a := range annotations {
		if err := store.SetAnnotation(a); err != nil {
			return err
		}
	}
	return nil
}

// testSheet stands in for the human copy the frontend builds — see the note
// on coach.WriteNotesArchive for why Go stopped rendering it.
var testSheet = []byte("<!doctype html><html><body>review</body></html>")
