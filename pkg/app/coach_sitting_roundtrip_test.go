package app_test

import (
	"archive/zip"
	"bytes"
	"slices"
	"testing"

	"recall/pkg/app"
	"recall/pkg/bundle"
	"recall/pkg/coach"
	"recall/pkg/db"
	"recall/pkg/match"
	"recall/pkg/matchedit"
	"recall/pkg/review"
)

// The self-review loop, on real bytes, both ZIPs opened and read.
//
// The player sits down with their own matches and writes what they saw ->
// exports the sitting to a coach -> the coach opens it and can READ what the
// player already concluded -> writes back notes, moments and a focus list ->
// the player imports the archive and accepts it.
//
// TestCoachingLoop_MomentsSurviveTheWholeRoundTrip covers the same wire from a
// share bundle. This one starts one step earlier, at the sitting, and asserts
// on what is INSIDE each archive rather than only on what comes out the far
// end: an archive that arrives empty and an archive that never carried the
// thing are the same failure at the destination and different failures here.

const sittingCoach = "Ordo"

// item_id and moment_id are UUIDs minted client-side — the validators hold
// every writer to that, so the fixtures spell real ones.
const (
	ownItemID     = "20000000-0000-4000-8000-00000000aa01"
	ownMomentID   = "20000000-0000-4000-8000-00000000bb01"
	coachItemDive = "10000000-0000-4000-8000-00000000cc01"
	coachItemSuzu = "10000000-0000-4000-8000-00000000cc02"
)

// entryNames lists a ZIP's top-level entries, so a test can say what the file
// IS rather than only what a reader made of it.
func entryNames(t *testing.T, payload []byte) []string {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		t.Fatalf("open zip: %v", err)
	}
	out := make([]string, 0, len(zr.File))
	for _, f := range zr.File {
		out = append(out, f.Name)
	}
	slices.Sort(out)
	return out
}

// writeTheSitting is the player's half before any coach is involved: a sitting
// over two matches, a note and a moment on one of them, one thing to work on,
// finished.
func writeTheSitting(t *testing.T, player *app.App) review.Session {
	t.Helper()
	sitting, err := player.CreateSelfReview(review.CreateInput{
		Title: "Tuesday, the Ana games", MatchKeys: []string{playerMatchRialto, playerMatchIlios},
	})
	mustNoErr(t, err)
	if _, err := player.PutSelfReviewNote(sitting.ReviewID, playerMatchRialto, coach.NoteInput{
		Kind: coach.KindNote, Text: "I keep nading the wall", FocusTags: []string{"cooldowns"},
	}); err != nil {
		t.Fatalf("PutSelfReviewNote: %v", err)
	}
	if _, err := player.PutSelfReviewMoment(sitting.ReviewID, playerMatchRialto, ownMomentID, matchedit.MomentInput{
		MatchClock: "5:12", Text: "walked in with no nade", FocusTag: "cooldowns",
	}); err != nil {
		t.Fatalf("PutSelfReviewMoment: %v", err)
	}
	if _, err := player.SetSelfReviewFocusItems(sitting.ReviewID, []db.FocusItem{
		{ItemID: ownItemID, Text: "hold nade for the dive"},
	}); err != nil {
		t.Fatalf("SetSelfReviewFocusItems: %v", err)
	}
	finished, err := player.FinishSelfReview(sitting.ReviewID)
	mustNoErr(t, err)
	return finished
}

// The manifest is the whole of a share bundle's identity: it is what makes
// OpenCoachSession accept the file, and what a mis-clicked Import refuses on.
func assertManifestNamesThePlayer(t *testing.T, mf bundle.ManifestV1) {
	t.Helper()
	if mf.Player == nil || mf.Player.Handle != playerHandle {
		t.Fatalf("manifest player = %+v, want it to name %q — this is what opens the session",
			mf.Player, playerHandle)
	}
	if mf.Player.Message != "look at my Ana" {
		t.Errorf("the player's message = %q, want it carried", mf.Player.Message)
	}
}

// assertShareZipCarriesTheSitting opens the outbound archive and reads it. The
// coach's whole view is built from these bytes, so what is missing here is
// missing from the session with nothing to say so.
func assertShareZipCarriesTheSitting(t *testing.T, payload []byte, reviewID string) {
	t.Helper()
	names := entryNames(t, payload)
	if !slices.Contains(names, "manifest.json") || !slices.Contains(names, "data.json") {
		t.Fatalf("share zip entries = %v, want manifest.json + data.json", names)
	}

	contents, err := bundle.Read(payload)
	mustNoErr(t, err)
	assertManifestNamesThePlayer(t, contents.Manifest)

	i := slices.IndexFunc(contents.Data.SelfReviews, func(r db.SelfReview) bool { return r.ReviewID == reviewID })
	if i < 0 {
		t.Fatalf("data.json carries %d sittings, none of them %s — the coach would open a bundle "+
			"with no sign the player had already reviewed these games", len(contents.Data.SelfReviews), reviewID)
	}
	sitting := contents.Data.SelfReviews[i]
	if sitting.Title != "Tuesday, the Ana games" {
		t.Errorf("sitting title = %q", sitting.Title)
	}
	if !slices.Contains(sitting.MatchKeys, playerMatchRialto) {
		t.Errorf("sitting members = %v, want the Rialto match", sitting.MatchKeys)
	}
	if len(sitting.FocusItems) != 1 || sitting.FocusItems[0].Text != "hold nade for the dive" {
		t.Errorf("the sitting's own conclusion = %+v, want it in the bundle", sitting.FocusItems)
	}
	assertSelfNoteInPayload(t, sitting.Notes)
}

func assertSelfNoteInPayload(t *testing.T, notes map[string]db.SelfReviewNote) {
	t.Helper()
	n, ok := notes[playerMatchRialto]
	if !ok {
		t.Fatalf("data.json carries no self-review note on the Rialto match: %d notes", len(notes))
	}
	if n.Text != "I keep nading the wall" {
		t.Errorf("the player's own words = %q", n.Text)
	}
	if len(n.Moments) != 1 || n.Moments[0].MatchClock != "05:12" {
		t.Errorf("self moments = %+v, want the one at 05:12", n.Moments)
	}
}

// assertNotesJSONHolds reads the machine copy — the one the player's import
// parses, and therefore the one that decides what actually arrives.
func assertNotesJSONHolds(t *testing.T, f coach.NotesFile) {
	t.Helper()
	if f.CoachName != sittingCoach || f.Player.Handle != playerHandle {
		t.Errorf("notes.json says coach %q, player %q — want %q / %q",
			f.CoachName, f.Player.Handle, sittingCoach, playerHandle)
	}
	if len(f.FocusItems) != 2 {
		t.Fatalf("focus items in the file = %d, want 2", len(f.FocusItems))
	}
	if f.FocusItems[0].Text != "nade the dive, not the wall" {
		t.Errorf("first focus item = %q, want the coach's order kept", f.FocusItems[0].Text)
	}
	if len(f.Notes) != 1 {
		t.Fatalf("notes in the file = %d, want the one match the coach wrote on", len(f.Notes))
	}
	if len(f.Notes[0].Moments) != 2 {
		t.Errorf("moments in the file = %d, want 2", len(f.Notes[0].Moments))
	}
}

// assertNotesZipCarriesTheCoachsWork opens the return archive. Both copies are
// asserted: notes.json is what the player's import reads, ledger.html is what
// a coach can open without Recall at all.
func assertNotesZipCarriesTheCoachsWork(t *testing.T, payload []byte) coach.NotesFile {
	t.Helper()
	names := entryNames(t, payload)
	if !slices.Contains(names, "notes.json") || !slices.Contains(names, "ledger.html") {
		t.Fatalf("notes zip entries = %v, want notes.json + ledger.html", names)
	}
	if coach.SniffArchive(payload) != coach.ArchiveCoachNotes {
		t.Fatal("the archive does not sniff as a notes file; the player's import would treat it as a bundle")
	}

	f, _, err := coach.ReadNotesArchive(payload)
	mustNoErr(t, err)
	assertNotesJSONHolds(t, f)

	// The human copy is the reason a second entry exists at all — a coach can
	// send this to a player who is not running Recall.
	//
	// What this asserts changed with the renderer. The page is built in the
	// FRONTEND now, where the app's real stylesheets live, so Go's contract
	// is no longer "the ledger says X" but "the bytes handed in are the bytes
	// that come out". That is the stronger claim of the two, and the only one
	// this side can honestly make; what the page CONTAINS is asserted by
	// coach-sheet.test.ts, against a builder that actually renders it.
	zr, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	mustNoErr(t, err)
	ledger, err := bundle.ReadZipEntry(zr, "ledger.html", 1<<20)
	mustNoErr(t, err)
	if !bytes.Equal(ledger, testSheet) {
		t.Errorf("ledger.html = %q, want the exact bytes handed to ExportCoachNotes", ledger)
	}
	return f
}

func TestCoachingLoop_ASittingGoesToACoachAndComesBack(t *testing.T) {
	// ── The player writes their own review, then sends it out. ───────────
	player, playerStore := playerApp(t)
	sitting := writeTheSitting(t, player)

	outbound, err := player.ExportShareBundle(
		app.ExportBundleOptions{MatchKeys: []string{playerMatchRialto, playerMatchIlios}},
		app.SharePlayer{Handle: playerHandle, Message: "look at my Ana"})
	mustNoErr(t, err)
	assertShareZipCarriesTheSitting(t, outbound, sitting.ReviewID)

	// ── A different install opens it, and can read what the player said. ──
	coachSide, _ := coachApp(t)
	if _, err := coachSide.OpenCoachSession(outbound); err != nil {
		t.Fatalf("OpenCoachSession: %v", err)
	}
	loaned, err := coachSide.GetCoachSessionMatches()
	mustNoErr(t, err)
	assertCoachSeesThePlayersReview(t, loaned, sitting.ReviewID)

	// ── The coach works, and hands an archive back. ──────────────────────
	if _, err := coachSide.PutCoachNote(playerMatchRialto, coach.NoteInput{
		Kind: coach.KindNote, Text: "the wall nade is a timing problem, not an aim one",
		FocusTags: []string{"cooldowns"},
	}); err != nil {
		t.Fatalf("PutCoachNote: %v", err)
	}
	markMoments(t, coachSide, playerMatchRialto, []coach.MomentInput{
		{MatchClock: "5:12", Text: "you already saw this one", FocusTag: "cooldowns"},
		{MatchClock: "2:04", Text: "and this is where it starts", FocusTag: "cooldowns"},
	})
	mustNoErr(t, coachSide.PutCoachFocusItems([]coach.FocusItem{
		{ItemID: coachItemDive, Text: "nade the dive, not the wall"},
		{ItemID: coachItemSuzu, Text: "count their Kiriko suzu"},
	}))
	_, inbound, err := coachSide.ExportCoachNotes(testSheet)
	mustNoErr(t, err)
	assertNotesZipCarriesTheCoachsWork(t, inbound)

	// ── The player takes it home. ────────────────────────────────────────
	acceptWholeArchive(t, player, playerStore, inbound, 2)
	assertTheCoachsWorkLanded(t, player, sitting.ReviewID)
}

// The coach's whole job is reading what the player already thinks. A bundle
// that arrives without it looks like a corpus of matches nobody has looked at.
//
// The Rialto match has been reviewed TWICE — the fixture's earlier sitting and
// the one this test writes — and the coach must see both. A room that shows
// only the newest hides the history the coach came for.
func assertCoachSeesThePlayersReview(t *testing.T, loaned []match.Record, reviewID string) {
	t.Helper()
	i := slices.IndexFunc(loaned, func(r match.Record) bool { return r.MatchKey == playerMatchRialto })
	if i < 0 {
		t.Fatalf("the loaned corpus has no Rialto match: %d records", len(loaned))
	}
	notes := loaned[i].SelfReviewNotes
	if len(notes) != 2 {
		t.Fatalf("self-review blocks in the room = %d, want both sittings: %+v", len(notes), notes)
	}
	j := slices.IndexFunc(notes, func(n match.SelfReviewNote) bool { return n.ReviewID == reviewID })
	if j < 0 {
		t.Fatalf("the sitting this test wrote is not in the room: %+v", notes)
	}
	if notes[j].Text != "I keep nading the wall" {
		t.Errorf("the block the coach reads = %q, want the player's own words", notes[j].Text)
	}
	if notes[j].ReviewTitle != "Tuesday, the Ana games" {
		t.Errorf("the sitting reads as %q, want its title so the coach knows which one", notes[j].ReviewTitle)
	}
	if len(notes[j].Moments) != 1 || notes[j].Moments[0].Text != "walked in with no nade" {
		t.Errorf("the player's moments did not reach the room: %+v", notes[j].Moments)
	}
}

// What the archive was FOR: the coach's block on the match, their moments in
// clock order beside the player's own, and the focus list live on the player's
// side — tied to the return that carried it.
func assertTheCoachsWorkLanded(t *testing.T, player *app.App, reviewID string) {
	t.Helper()
	blocks, err := app.Store(player).LoadMatchCoachNotes()
	mustNoErr(t, err)
	onMatch := blocks[playerMatchRialto]
	if len(onMatch) != 1 {
		t.Fatalf("coach blocks on the match = %d, want 1", len(onMatch))
	}
	if got := momentClocks(onMatch[0]); !slices.Equal(got, []string{"02:04", "05:12"}) {
		t.Errorf("moments read back %v, want [02:04 05:12] — the strip reads down the match", got)
	}

	list, err := player.FocusList()
	mustNoErr(t, err)
	assertFocusListReads(t, list)

	// The player's own sitting is untouched by any of it.
	sitting, err := player.GetSelfReview(reviewID)
	mustNoErr(t, err)
	if sitting.Notes[playerMatchRialto].Text != "I keep nading the wall" {
		t.Errorf("the sitting's own note changed: %+v", sitting.Notes[playerMatchRialto])
	}
}

// The coach's items lead, newest first, and the player's own follow. Every one
// of the coach's is `new` — it landed the moment the archive was staged, and
// Accept is an acknowledgement, not an admission.
func assertFocusListReads(t *testing.T, list []app.FocusEntry) {
	t.Helper()
	var fromCoach, own []app.FocusEntry
	for _, e := range list {
		if e.Source == "coach" {
			fromCoach = append(fromCoach, e)
			continue
		}
		own = append(own, e)
	}
	if len(fromCoach) != 2 {
		t.Fatalf("coach items on the player's list = %d, want 2: %+v", len(fromCoach), list)
	}
	if fromCoach[0].Text != "nade the dive, not the wall" {
		t.Errorf("first coach item = %q, want the coach's order kept", fromCoach[0].Text)
	}
	for _, e := range fromCoach {
		if e.Status != string(db.FocusNew) {
			t.Errorf("item %q landed as %q, want %q", e.Text, e.Status, db.FocusNew)
		}
		if e.CoachName != sittingCoach {
			t.Errorf("item %q says it came from %q, want %q — provenance is read through the return",
				e.Text, e.CoachName, sittingCoach)
		}
	}
	if len(own) != 1 || own[0].Text != "hold nade for the dive" {
		t.Errorf("the player's own item = %+v, want it still there beside the coach's", own)
	}
}
