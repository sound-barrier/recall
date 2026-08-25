package db_test

import (
	"errors"
	"slices"
	"testing"
	"time"

	"recall/pkg/db"
)

// Coaching contract suite — every assertion runs against BOTH Store
// implementations (see storeImpls in store_contract_test.go). Two families
// live here: coach-AUTHORED (what this user wrote about someone else, keyed
// by CoachPlayer, survives Clear) and coach-RECEIVED (notes accepted onto
// this user's own matches, keyed by match_key, wiped like every sidecar).

const (
	coachKey      = "match-2026-08-08T20-15-00"
	coachOtherKey = "match-2026-08-08T21-05-00"
)

func ensurePlayer(t *testing.T, s db.Store, playerID, handle string) db.CoachPlayer {
	t.Helper()
	p, err := s.EnsureCoachPlayer(playerID, handle, db.CoachKindPlayer)
	mustNoErr(t, err)
	if p.ID == 0 {
		t.Fatalf("EnsureCoachPlayer(%q, %q, db.CoachKindPlayer) returned a zero id", playerID, handle)
	}
	return p
}

func assertRFC3339(t *testing.T, field, value string) {
	t.Helper()
	if _, err := time.Parse(time.RFC3339, value); err != nil {
		t.Errorf("%s = %q is not RFC3339: %v", field, value, err)
	}
}

// sameTags treats nil and empty as equal — a note with no tags reads back
// either way depending on the implementation's container choice.
func sameTags(got, want []string) bool {
	return len(got) == 0 && len(want) == 0 || slices.Equal(got, want)
}

// Identity is the player's UUID when the bundle carried one, else the handle
// (case-insensitively). An anonymous first meeting followed by an identified
// bundle from the same handle must converge on ONE row with the id
// backfilled — otherwise the coach's earlier notes vanish the moment the
// player upgrades and re-exports.
func TestStoreContract_EnsureCoachPlayerMatchesByIDThenHandleAndBackfills(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			anon := ensurePlayer(t, s, "", "Sable")
			if anon.Handle != "Sable" || anon.PlayerID != "" {
				t.Fatalf("created player = %+v, want handle Sable and no id", anon)
			}
			if again := ensurePlayer(t, s, "", "SABLE"); again.ID != anon.ID {
				t.Errorf("handle match is not case-insensitive: %+v vs %+v", again, anon)
			}
			backfilled := ensurePlayer(t, s, "player-uuid-1", "sable")
			if backfilled.ID != anon.ID || backfilled.PlayerID != "player-uuid-1" {
				t.Errorf("identified bundle did not adopt + backfill the handle row: %+v", backfilled)
			}
			byID := ensurePlayer(t, s, "player-uuid-1", "Renamed Elsewhere")
			if byID.ID != anon.ID || byID.Handle != "Sable" {
				t.Errorf("player_id match must win over the handle and leave the handle alone: %+v", byID)
			}
			// A different identity sharing the handle is a different player.
			if other := ensurePlayer(t, s, "player-uuid-2", "Sable"); other.ID == anon.ID {
				t.Errorf("a second player_id with the same handle collapsed onto the first row: %+v", other)
			}
		})
	}
}

func TestStoreContract_RenameCoachPlayerIsDisplayOnlyAndRefusesUnknownIDs(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			p := ensurePlayer(t, s, "player-uuid-1", "Sable")
			mustNoErr(t, s.RenameCoachPlayer(p.ID, "Sable (EU)"))
			renamed := ensurePlayer(t, s, "player-uuid-1", "ignored")
			if renamed.ID != p.ID || renamed.Handle != "Sable (EU)" {
				t.Errorf("after rename = %+v, want the same row with the new handle", renamed)
			}
			if err := s.RenameCoachPlayer(p.ID+99, "ghost"); !errors.Is(err, db.ErrCoachPlayerUnknown) {
				t.Errorf("rename of an unknown player = %v, want ErrCoachPlayerUnknown", err)
			}
		})
	}
}

// One note per (player, match): a re-save replaces kind / text / clock and
// the tag sets wholesale, keeps the note_id minted on the first save (the
// player's side dedupes on it), and never grows a second row.
func TestStoreContract_UpsertCoachNoteMintsAndKeepsNoteIDAndReplacesTags(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			p := ensurePlayer(t, s, "", "Sable")
			first, err := s.UpsertCoachNote(db.CoachNote{
				PlayerRef: p.ID, MatchKey: coachKey, Kind: "note", Text: "hold high ground",
				MatchClock: "04:12", FocusTags: []string{"positioning", "comms", "comms"},
				ExtraTags: []string{"ana"},
			})
			mustNoErr(t, err)
			assertMintedNote(t, first)

			second, err := s.UpsertCoachNote(db.CoachNote{
				PlayerRef: p.ID, MatchKey: coachKey, Kind: "reviewed_only",
				FocusTags: []string{"mechanics"},
			})
			mustNoErr(t, err)
			if second.NoteID != first.NoteID {
				t.Errorf("re-save minted a new note_id %q, want %q kept", second.NoteID, first.NoteID)
			}
			notes, err := s.LoadCoachNotes(p.ID)
			mustNoErr(t, err)
			if len(notes) != 1 {
				t.Fatalf("notes = %d, want exactly one per (player, match)", len(notes))
			}
			assertReplacedNote(t, notes[coachKey], first)
		})
	}
}

// assertMintedNote pins the first-save shape: a UUID-length note_id and
// server-stamped RFC3339 timestamps, tags deduped and sorted.
func assertMintedNote(t *testing.T, n db.CoachNote) {
	t.Helper()
	if len(n.NoteID) != 36 {
		t.Errorf("NoteID = %q, want a minted UUID", n.NoteID)
	}
	assertRFC3339(t, "CreatedAt", n.CreatedAt)
	assertRFC3339(t, "UpdatedAt", n.UpdatedAt)
	if !sameTags(n.FocusTags, []string{"comms", "positioning"}) {
		t.Errorf("FocusTags = %v, want deduped + sorted [comms positioning]", n.FocusTags)
	}
}

// assertReplacedNote pins the re-saved row: new kind, empty text, tag sets
// replaced (not merged), created_at preserved.
func assertReplacedNote(t *testing.T, got, first db.CoachNote) {
	t.Helper()
	if got.Kind != "reviewed_only" || got.Text != "" || got.MatchClock != "" {
		t.Errorf("re-saved note = %+v, want kind reviewed_only with text/clock cleared", got)
	}
	if !sameTags(got.FocusTags, []string{"mechanics"}) || !sameTags(got.ExtraTags, nil) {
		t.Errorf("tags = %v / %v, want [mechanics] / none — sets replace, never merge", got.FocusTags, got.ExtraTags)
	}
	if got.CreatedAt != first.CreatedAt {
		t.Errorf("CreatedAt = %q, want the first-save value %q preserved", got.CreatedAt, first.CreatedAt)
	}
	if got.NoteID != first.NoteID || got.PlayerRef != first.PlayerRef || got.MatchKey != coachKey {
		t.Errorf("identity drifted on re-save: %+v", got)
	}
}

func TestStoreContract_UpsertCoachNoteKeepsACallerNoteIDAndScopesByPlayer(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			sable := ensurePlayer(t, s, "p1", "Sable")
			ordo := ensurePlayer(t, s, "p2", "Ordo")
			n, err := s.UpsertCoachNote(db.CoachNote{NoteID: "note-fixed", PlayerRef: sable.ID, MatchKey: coachKey, Kind: "note", Text: "a"})
			mustNoErr(t, err)
			if n.NoteID != "note-fixed" {
				t.Errorf("NoteID = %q, want the caller's id kept", n.NoteID)
			}
			_, err = s.UpsertCoachNote(db.CoachNote{PlayerRef: ordo.ID, MatchKey: coachKey, Kind: "note", Text: "b"})
			mustNoErr(t, err)
			sableNotes, err := s.LoadCoachNotes(sable.ID)
			mustNoErr(t, err)
			ordoNotes, err := s.LoadCoachNotes(ordo.ID)
			mustNoErr(t, err)
			if len(sableNotes) != 1 || len(ordoNotes) != 1 || sableNotes[coachKey].Text != "a" || ordoNotes[coachKey].Text != "b" {
				t.Errorf("notes leaked across players: sable=%v ordo=%v", sableNotes, ordoNotes)
			}
		})
	}
}

// The schema pins the kind and focus-tag vocabularies with CHECK constraints
// and the player FK; the Fake must refuse the same inputs so app tests can't
// reach a state production cannot.
func TestStoreContract_UpsertCoachNoteRefusesBadKindTagAndPlayer(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			p := ensurePlayer(t, s, "", "Sable")
			if _, err := s.UpsertCoachNote(db.CoachNote{PlayerRef: p.ID, MatchKey: coachKey, Kind: "rant"}); err == nil {
				t.Error("kind outside note/reviewed_only was accepted")
			}
			if _, err := s.UpsertCoachNote(db.CoachNote{PlayerRef: p.ID, MatchKey: coachKey, Kind: "note", FocusTags: []string{"vibes"}}); err == nil {
				t.Error("focus tag outside the vocabulary was accepted")
			}
			_, err := s.UpsertCoachNote(db.CoachNote{PlayerRef: p.ID + 99, MatchKey: coachKey, Kind: "note"})
			if !errors.Is(err, db.ErrCoachPlayerUnknown) {
				t.Errorf("unknown player = %v, want ErrCoachPlayerUnknown", err)
			}
			if notes, _ := s.LoadCoachNotes(p.ID); len(notes) != 0 {
				t.Errorf("a refused save left rows behind: %v", notes)
			}
		})
	}
}

func TestStoreContract_DeleteCoachNoteRemovesTheRowAndIsIdempotent(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			p := ensurePlayer(t, s, "", "Sable")
			_, err := s.UpsertCoachNote(db.CoachNote{PlayerRef: p.ID, MatchKey: coachKey, Kind: "note", Text: "a", FocusTags: []string{"comms"}})
			mustNoErr(t, err)
			_, err = s.UpsertCoachNote(db.CoachNote{PlayerRef: p.ID, MatchKey: coachOtherKey, Kind: "note", Text: "b"})
			mustNoErr(t, err)
			mustNoErr(t, s.DeleteCoachNote(p.ID, coachKey))
			mustNoErr(t, s.DeleteCoachNote(p.ID, coachKey)) // absent → no-op
			notes, err := s.LoadCoachNotes(p.ID)
			mustNoErr(t, err)
			if _, gone := notes[coachKey]; gone || len(notes) != 1 {
				t.Errorf("after delete notes = %v, want only %s", notes, coachOtherKey)
			}
		})
	}
}

// The coach's focus list is replaced wholesale, so an empty slice clears it
// — an autosave of a list the coach emptied leaves nothing behind.
func TestStoreContract_SetCoachFocusItemsEmptyClears(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			p := ensurePlayer(t, s, "", "Sable")
			if got, err := s.LoadCoachFocusItems(p.ID); err != nil || len(got) != 0 {
				t.Fatalf("fresh player list = (%v, %v), want empty", got, err)
			}
			mustNoErr(t, s.SetCoachFocusItems(p.ID, []db.FocusItem{{ItemID: "f-1", Text: "ult tracking"}}))
			mustNoErr(t, s.SetCoachFocusItems(p.ID, []db.FocusItem{
				{ItemID: "f-1", Text: "ult tracking"},
				{ItemID: "f-2", Text: "comms"},
			}))
			got, err := s.LoadCoachFocusItems(p.ID)
			mustNoErr(t, err)
			if len(got) != 2 || got[0].Text != "ult tracking" || got[1].Text != "comms" {
				t.Errorf("items = %+v, want the replacement list in order", got)
			}
			assertRFC3339(t, "UpdatedAt", got[0].UpdatedAt)
			mustNoErr(t, s.SetCoachFocusItems(p.ID, nil))
			if got, _ := s.LoadCoachFocusItems(p.ID); len(got) != 0 {
				t.Errorf("an empty slice did not clear the list: %+v", got)
			}
		})
	}
}

// Received notes accumulate per match — one block per coach note — and
// importing the same notes file twice upserts on note_id instead of
// duplicating a block.
func TestStoreContract_UpsertMatchCoachNoteAccumulatesPerNoteIDAndUpsertsOnRepeat(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			id1, err := s.UpsertMatchCoachNote(receivedNote("n1", "hold high ground", "positioning"))
			mustNoErr(t, err)
			id2, err := s.UpsertMatchCoachNote(receivedNote("n2", "track ults", "ult_economy"))
			mustNoErr(t, err)
			if id1 == 0 || id1 == id2 {
				t.Fatalf("ids = %d, %d — want two distinct non-zero rows", id1, id2)
			}
			again, err := s.UpsertMatchCoachNote(receivedNote("n1", "hold high ground (revised)", "comms"))
			mustNoErr(t, err)
			if again != id1 {
				t.Errorf("re-import of n1 got id %d, want the existing %d", again, id1)
			}
			byKey, err := s.LoadMatchCoachNotes()
			mustNoErr(t, err)
			assertAccumulatedBlocks(t, byKey[coachKey], id1, id2)
			if _, err := s.UpsertMatchCoachNote(receivedNote("", "anonymous", "comms")); err == nil {
				t.Error("an empty note_id was accepted; every anonymous note would collide on it")
			}
		})
	}
}

func receivedNote(noteID, text, focus string) db.MatchCoachNote {
	return db.MatchCoachNote{
		NoteID: noteID, MatchKey: coachKey, CoachName: "Ordo", SessionDate: "2026-08-08",
		Text: text, MatchClock: "04:12", FocusTags: []string{focus}, ExtraTags: []string{"ana"},
	}
}

// assertAccumulatedBlocks pins the per-match list: two blocks, insertion
// order (accepted_at, then id), n1's re-import applied in place.
func assertAccumulatedBlocks(t *testing.T, blocks []db.MatchCoachNote, id1, id2 int64) {
	t.Helper()
	if len(blocks) != 2 {
		t.Fatalf("blocks for %s = %+v, want two", coachKey, blocks)
	}
	if blocks[0].ID != id1 || blocks[1].ID != id2 {
		t.Errorf("order = [%d %d], want [%d %d] (accepted_at, then id)", blocks[0].ID, blocks[1].ID, id1, id2)
	}
	revised := blocks[0]
	if revised.Text != "hold high ground (revised)" || !sameTags(revised.FocusTags, []string{"comms"}) {
		t.Errorf("re-imported n1 = %+v, want revised text + replaced tags", revised)
	}
	if revised.CoachName != "Ordo" || revised.SessionDate != "2026-08-08" || revised.MatchClock != "04:12" || !sameTags(revised.ExtraTags, []string{"ana"}) {
		t.Errorf("n1 lost scalars on re-import: %+v", revised)
	}
	assertRFC3339(t, "AcceptedAt", revised.AcceptedAt)
}

func TestStoreContract_DeleteMatchCoachNoteRemovesOneBlockAndReportsUnknownIDs(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			id1, err := s.UpsertMatchCoachNote(receivedNote("n1", "a", "comms"))
			mustNoErr(t, err)
			_, err = s.UpsertMatchCoachNote(receivedNote("n2", "b", "comms"))
			mustNoErr(t, err)
			mustNoErr(t, s.DeleteMatchCoachNote(id1))
			byKey, err := s.LoadMatchCoachNotes()
			mustNoErr(t, err)
			if len(byKey[coachKey]) != 1 || byKey[coachKey][0].NoteID != "n2" {
				t.Errorf("after delete = %+v, want only n2", byKey[coachKey])
			}
			if err := s.DeleteMatchCoachNote(id1); !errors.Is(err, db.ErrMatchCoachNoteUnknown) {
				t.Errorf("second delete = %v, want ErrMatchCoachNoteUnknown", err)
			}
		})
	}
}

// HardDeleteMatch wipes the received layer for the key AND the return-sheet
// decisions that pointed at those notes — otherwise a re-opened sheet
// still shows "accepted" for a note whose block no longer exists.
func TestStoreContract_HardDeleteWipesReceivedCoachLayerAndItsDecisions(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			_, err := s.UpsertMatchCoachNote(receivedNote("n1", "a", "comms"))
			mustNoErr(t, err)
			other := receivedNote("n2", "b", "comms")
			other.MatchKey = coachOtherKey
			_, err = s.UpsertMatchCoachNote(other)
			mustNoErr(t, err)
			ret, err := s.InsertCoachReturn(db.CoachReturn{ContentHash: "h1", CoachName: "Ordo", PlayerHandle: "Sable", SessionDate: "2026-08-08", NotesJSON: []byte(`{}`)})
			mustNoErr(t, err)
			mustNoErr(t, s.SetCoachReturnDecision(ret, "n1", "accepted"))
			mustNoErr(t, s.SetCoachReturnDecision(ret, "n2", "accepted"))
			mustNoErr(t, s.SetCoachReturnDecision(ret, "n3", "skipped"))

			mustNoErr(t, s.HardDeleteMatch(coachKey))

			byKey, err := s.LoadMatchCoachNotes()
			mustNoErr(t, err)
			if _, survived := byKey[coachKey]; survived || len(byKey[coachOtherKey]) != 1 {
				t.Errorf("received notes after hard delete = %v, want only %s", byKey, coachOtherKey)
			}
			loaded, ok, err := s.LoadCoachReturn(ret)
			mustNoErr(t, err)
			if !ok {
				t.Fatal("the return itself must survive a match delete")
			}
			if _, gone := loaded.Decisions["n1"]; gone || len(loaded.Decisions) != 2 {
				t.Errorf("decisions = %v, want n1 forgotten and n2/n3 kept", loaded.Decisions)
			}
		})
	}
}

// Clear is "wipe my match history": the received family goes, but the notes
// this user AUTHORED about other players are not match history — a coach
// clearing an empty database must not lose their coaching work.
func TestStoreContract_ClearWipesReceivedButKeepsCoachAuthored(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			p := ensurePlayer(t, s, "p1", "Sable")
			_, err := s.UpsertCoachNote(db.CoachNote{PlayerRef: p.ID, MatchKey: coachKey, Kind: "note", Text: "keep me", FocusTags: []string{"comms"}})
			mustNoErr(t, err)
			mustNoErr(t, s.SetCoachFocusItems(p.ID, []db.FocusItem{{ItemID: "f-keep", Text: "keep me too"}}))
			_, err = s.UpsertMatchCoachNote(receivedNote("n1", "a", "comms"))
			mustNoErr(t, err)
			_, err = s.InsertCoachReturn(db.CoachReturn{ContentHash: "h1", CoachName: "Ordo", PlayerHandle: "Sable", SessionDate: "2026-08-08", NotesJSON: []byte(`{}`)})
			mustNoErr(t, err)

			mustNoErr(t, s.Clear())

			assertReceivedLayerEmpty(t, s)
			assertAuthoredLayerKept(t, s, p)
		})
	}
}

func assertReceivedLayerEmpty(t *testing.T, s db.Store) {
	t.Helper()
	if byKey, _ := s.LoadMatchCoachNotes(); len(byKey) != 0 {
		t.Errorf("received notes survived Clear: %v", byKey)
	}
	if returns, _ := s.LoadCoachReturns(); len(returns) != 0 {
		t.Errorf("staged returns survived Clear: %v", returns)
	}
}

func assertAuthoredLayerKept(t *testing.T, s db.Store, p db.CoachPlayer) {
	t.Helper()
	if again := ensurePlayer(t, s, "p1", "Sable"); again.ID != p.ID {
		t.Errorf("Clear dropped the coached player: got %+v, want id %d", again, p.ID)
	}
	notes, err := s.LoadCoachNotes(p.ID)
	mustNoErr(t, err)
	if notes[coachKey].Text != "keep me" || !sameTags(notes[coachKey].FocusTags, []string{"comms"}) {
		t.Errorf("Clear dropped coach-authored notes: %v", notes)
	}
	if items, _ := s.LoadCoachFocusItems(p.ID); len(items) != 1 || items[0].Text != "keep me too" {
		t.Errorf("Clear dropped the coach focus list: %+v", items)
	}
}

func stagedReturn(hash string) db.CoachReturn {
	return db.CoachReturn{
		ContentHash: hash, CoachName: "Ordo", PlayerHandle: "Sable",
		SessionDate: "2026-08-08", NotesJSON: []byte(`{"schema":"recall-coach-notes/v1"}`),
	}
}

// A staged return is the notes file itself: the same bytes imported twice
// are the same row (hash-unique), decisions upsert per note_id, and deleting
// the return takes its decisions with it.
func TestStoreContract_CoachReturnHashIsUniqueDecisionsUpsertAndCascade(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			id, err := s.InsertCoachReturn(stagedReturn("h1"))
			mustNoErr(t, err)
			if _, err := s.InsertCoachReturn(stagedReturn("h1")); err == nil {
				t.Error("a second return with the same content_hash was accepted")
			}
			found, ok, err := s.LookupCoachReturnByHash("h1")
			mustNoErr(t, err)
			if !ok || found.ID != id || string(found.NotesJSON) != `{"schema":"recall-coach-notes/v1"}` || found.CoachName != "Ordo" {
				t.Errorf("LookupCoachReturnByHash = (%+v, %v), want the inserted row", found, ok)
			}
			assertRFC3339(t, "ImportedAt", found.ImportedAt)
			if _, ok, _ := s.LookupCoachReturnByHash("nope"); ok {
				t.Error("unknown hash reported found")
			}
			assertDecisionsUpsert(t, s, id)
			mustNoErr(t, s.DeleteCoachReturn(id))
			if _, ok, _ := s.LoadCoachReturn(id); ok {
				t.Error("deleted return still loads")
			}
			if err := s.DeleteCoachReturn(id); !errors.Is(err, db.ErrCoachReturnUnknown) {
				t.Errorf("second delete = %v, want ErrCoachReturnUnknown", err)
			}
		})
	}
}

// assertDecisionsUpsert pins the per-note verdict semantics: repeat sets
// overwrite, the vocabulary is enforced, unknown returns are refused.
func assertDecisionsUpsert(t *testing.T, s db.Store, id int64) {
	t.Helper()
	mustNoErr(t, s.SetCoachReturnDecision(id, "n1", "accepted"))
	mustNoErr(t, s.SetCoachReturnDecision(id, "n1", "skipped"))
	mustNoErr(t, s.SetCoachReturnDecision(id, "n2", "accepted"))
	if err := s.SetCoachReturnDecision(id, "n3", "maybe"); err == nil {
		t.Error("decision outside accepted/skipped was accepted")
	}
	if err := s.SetCoachReturnDecision(id+99, "n1", "accepted"); !errors.Is(err, db.ErrCoachReturnUnknown) {
		t.Errorf("decision on an unknown return = %v, want ErrCoachReturnUnknown", err)
	}
	loaded, ok, err := s.LoadCoachReturn(id)
	mustNoErr(t, err)
	if !ok || len(loaded.Decisions) != 2 || loaded.Decisions["n1"].Decision != "skipped" || loaded.Decisions["n2"].Decision != "accepted" {
		t.Errorf("decisions = %+v, want n1 skipped (overwritten) + n2 accepted", loaded.Decisions)
	}
	assertRFC3339(t, "DecidedAt", loaded.Decisions["n1"].DecidedAt)
}

func TestStoreContract_LoadCoachReturnsNewestFirstWithDecisionsAttached(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			first, err := s.InsertCoachReturn(stagedReturn("h1"))
			mustNoErr(t, err)
			second, err := s.InsertCoachReturn(stagedReturn("h2"))
			mustNoErr(t, err)
			mustNoErr(t, s.SetCoachReturnDecision(first, "n1", "accepted"))
			returns, err := s.LoadCoachReturns()
			mustNoErr(t, err)
			if len(returns) != 2 || returns[0].ID != second || returns[1].ID != first {
				t.Fatalf("returns = %+v, want [%d %d] newest first", returns, second, first)
			}
			if returns[1].Decisions["n1"].Decision != "accepted" || returns[0].Decisions == nil || len(returns[0].Decisions) != 0 {
				t.Errorf("decisions not attached per return: %+v", returns)
			}
			if _, ok, err := s.LoadCoachReturn(second + 99); err != nil || ok {
				t.Errorf("unknown return = (%v, %v), want (false, nil)", ok, err)
			}
		})
	}
}

// The tracked-key set the coach side validates notes against — OCR rows AND
// the manual layer, since a hand-entered match is as real as a parsed one.
func TestStoreContract_LoadMatchKeysSeesOCRAndManualLayers(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			keys, err := s.LoadMatchKeys()
			mustNoErr(t, err)
			if keys == nil || len(keys) != 0 {
				t.Fatalf("empty store keys = %v, want an empty non-nil map", keys)
			}
			mustNoErr(t, s.UpsertSummary(db.SummaryRow{Filename: "a.png", MatchKey: "match-2026-01-01T12-00-00"}))
			mustNoErr(t, s.UpsertTeams(db.TeamsRow{Filename: "b.png", MatchKey: "match-2026-01-01T12-00-00"}))
			mustNoErr(t, s.UpsertRank(db.RankRow{Filename: "c.png", MatchKey: "match-2026-01-01T13-00-00"}))
			mustNoErr(t, s.UpsertUserMatchData(db.UserMatchData{MatchKey: "match-2026-01-02T12-00-00", Map: new("busan")}))
			keys, err = s.LoadMatchKeys()
			mustNoErr(t, err)
			want := []string{"match-2026-01-01T12-00-00", "match-2026-01-01T13-00-00", "match-2026-01-02T12-00-00"}
			if len(keys) != len(want) {
				t.Fatalf("keys = %v, want %v", keys, want)
			}
			for _, k := range want {
				if !keys[k] {
					t.Errorf("key %q missing from %v", k, keys)
				}
			}
		})
	}
}

// ── A note's timestamped moments ──────────────────────────────────────────

// assertThreeMoments checks the round trip of the three-observation review
// this suite writes: all three present, in match order, tags carried.
func assertThreeMoments(t *testing.T, got []db.CoachNoteMoment) {
	t.Helper()
	if len(got) != 3 {
		t.Fatalf("moments = %d, want 3 on one match", len(got))
	}
	if got[0].MatchClock != "03:23" || got[2].MatchClock != "04:45" {
		t.Errorf("moments should load down the match, got %q…%q", got[0].MatchClock, got[2].MatchClock)
	}
	if got[0].FocusTag != "positioning" {
		t.Errorf("focus tag should survive the round trip, got %q", got[0].FocusTag)
	}
	if got[2].FocusTag != "" {
		t.Errorf("an untagged moment stays untagged, got %q", got[2].FocusTag)
	}
}

// The point of moments: several observations on ONE match, which the note
// alone could never carry — it had a single clock field, so a coach with three
// things to say at three times had to pick one.
func TestCoachNoteMoments_ManyPerMatch(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			p := ensurePlayer(t, s, "", "Sable")
			note, err := s.UpsertCoachNote(db.CoachNote{
				PlayerRef: p.ID, MatchKey: coachKey, Kind: "note", Text: "faded late",
			})
			mustNoErr(t, err)

			for _, m := range []db.CoachNoteMoment{
				{NoteID: note.NoteID, MatchClock: "03:23", Text: "no off-angle", FocusTag: "positioning", SortOrder: 0},
				{NoteID: note.NoteID, MatchClock: "04:13", Text: "no ult tracking", FocusTag: "ult_economy", SortOrder: 1},
				{NoteID: note.NoteID, MatchClock: "04:45", Text: "flanking Cassidy", SortOrder: 2},
			} {
				saved, err := s.UpsertCoachNoteMoment(p.ID, m)
				mustNoErr(t, err)
				if saved.MomentID == "" {
					t.Fatal("a saved moment must carry a minted id")
				}
			}

			byNote, err := s.LoadCoachNoteMoments(p.ID)
			mustNoErr(t, err)
			assertThreeMoments(t, byNote[note.NoteID])
		})
	}
}

// An edit keeps the moment's identity — the same rule the note follows, and
// what lets the autosave queue key on an id it minted before the first save.
func TestCoachNoteMoments_EditKeepsIdentity(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			p := ensurePlayer(t, s, "", "Sable")
			note, err := s.UpsertCoachNote(db.CoachNote{PlayerRef: p.ID, MatchKey: coachKey, Kind: "note", Text: "x"})
			mustNoErr(t, err)

			first, err := s.UpsertCoachNoteMoment(p.ID, db.CoachNoteMoment{
				NoteID: note.NoteID, MatchClock: "03:23", Text: "no off-angle",
			})
			mustNoErr(t, err)
			second, err := s.UpsertCoachNoteMoment(p.ID, db.CoachNoteMoment{
				MomentID: first.MomentID, NoteID: note.NoteID,
				MatchClock: "03:30", Text: "no off-angle — tank ate it",
			})
			mustNoErr(t, err)

			if second.MomentID != first.MomentID {
				t.Errorf("an edit minted a new id %q, want %q kept", second.MomentID, first.MomentID)
			}
			byNote, err := s.LoadCoachNoteMoments(p.ID)
			mustNoErr(t, err)
			if got := byNote[note.NoteID]; len(got) != 1 || got[0].MatchClock != "03:30" {
				t.Fatalf("want one edited moment at 03:30, got %+v", got)
			}
		})
	}
}

// A moment id from another coach's player must not resolve. The session view
// is the only thing scoping these, so the store has to hold the line itself.
func TestCoachNoteMoments_ScopedToThePlayer(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			sable := ensurePlayer(t, s, "", "Sable")
			ordo := ensurePlayer(t, s, "", "Ordo")
			note, err := s.UpsertCoachNote(db.CoachNote{PlayerRef: sable.ID, MatchKey: coachKey, Kind: "note", Text: "x"})
			mustNoErr(t, err)

			if _, err := s.UpsertCoachNoteMoment(ordo.ID, db.CoachNoteMoment{
				NoteID: note.NoteID, MatchClock: "03:23", Text: "reaching across",
			}); !errors.Is(err, db.ErrCoachNoteUnknown) {
				t.Fatalf("want ErrCoachNoteUnknown writing to another player's note, got %v", err)
			}

			saved, err := s.UpsertCoachNoteMoment(sable.ID, db.CoachNoteMoment{
				NoteID: note.NoteID, MatchClock: "03:23", Text: "mine",
			})
			mustNoErr(t, err)
			mustNoErr(t, s.DeleteCoachNoteMoment(ordo.ID, saved.MomentID))

			byNote, err := s.LoadCoachNoteMoments(sable.ID)
			mustNoErr(t, err)
			if len(byNote[note.NoteID]) != 1 {
				t.Fatal("another player's delete removed a moment it should not reach")
			}
		})
	}
}

// Deleting the note takes its moments with it — otherwise a re-noted match
// would resurface observations the coach thought they had thrown away.
func TestCoachNoteMoments_FollowTheNoteOnDelete(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			p := ensurePlayer(t, s, "", "Sable")
			note, err := s.UpsertCoachNote(db.CoachNote{PlayerRef: p.ID, MatchKey: coachKey, Kind: "note", Text: "x"})
			mustNoErr(t, err)
			_, err = s.UpsertCoachNoteMoment(p.ID, db.CoachNoteMoment{
				NoteID: note.NoteID, MatchClock: "03:23", Text: "no off-angle",
			})
			mustNoErr(t, err)

			mustNoErr(t, s.DeleteCoachNote(p.ID, coachKey))

			byNote, err := s.LoadCoachNoteMoments(p.ID)
			mustNoErr(t, err)
			if len(byNote[note.NoteID]) != 0 {
				t.Fatalf("moments outlived their note: %+v", byNote[note.NoteID])
			}
		})
	}
}

// The vocabulary is a CHECK in SQL; the Fake has to refuse the same tag or the
// two stores disagree about what is storable.
func TestCoachNoteMoments_RefuseATagOutsideTheVocabulary(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			p := ensurePlayer(t, s, "", "Sable")
			note, err := s.UpsertCoachNote(db.CoachNote{PlayerRef: p.ID, MatchKey: coachKey, Kind: "note", Text: "x"})
			mustNoErr(t, err)

			if _, err := s.UpsertCoachNoteMoment(p.ID, db.CoachNoteMoment{
				NoteID: note.NoteID, MatchClock: "03:23", Text: "x", FocusTag: "vibes",
			}); err == nil {
				t.Fatal("a tag outside the vocabulary must be refused")
			}
		})
	}
}

// The id a moment carries is minted by the CLIENT, so it is not a namespace
// the store may trust. A global UNIQUE made it one: an upsert conflicting on
// the id alone matched a row belonging to another note — another PLAYER, even
// — rewrote it, and dropped the caller's own write on the floor while
// answering 200.
func TestCoachNoteMoments_AnIDCollisionDoesNotCrossNotes(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			sable := ensurePlayer(t, s, "", "Sable")
			ordo := ensurePlayer(t, s, "", "Ordo")
			sableNote, err := s.UpsertCoachNote(db.CoachNote{PlayerRef: sable.ID, MatchKey: coachKey, Kind: "note", Text: "x"})
			mustNoErr(t, err)
			ordoNote, err := s.UpsertCoachNote(db.CoachNote{PlayerRef: ordo.ID, MatchKey: coachKey, Kind: "note", Text: "x"})
			mustNoErr(t, err)

			const shared = "collide"
			_, err = s.UpsertCoachNoteMoment(sable.ID, db.CoachNoteMoment{
				MomentID: shared, NoteID: sableNote.NoteID, MatchClock: "03:23", Text: "SABLE ORIGINAL",
			})
			mustNoErr(t, err)
			_, err = s.UpsertCoachNoteMoment(ordo.ID, db.CoachNoteMoment{
				MomentID: shared, NoteID: ordoNote.NoteID, MatchClock: "09:59", Text: "ORDO WROTE THIS",
			})
			mustNoErr(t, err)

			sableMoments, err := s.LoadCoachNoteMoments(sable.ID)
			mustNoErr(t, err)
			if got := sableMoments[sableNote.NoteID]; len(got) != 1 || got[0].Text != "SABLE ORIGINAL" {
				t.Fatalf("Sable's moment was overwritten across players: %+v", got)
			}
			ordoMoments, err := s.LoadCoachNoteMoments(ordo.ID)
			mustNoErr(t, err)
			if got := ordoMoments[ordoNote.NoteID]; len(got) != 1 || got[0].Text != "ORDO WROTE THIS" {
				t.Fatalf("Ordo's write vanished: %+v", got)
			}
		})
	}
}

// The reachable form of the same bug, inside ONE coach's data: any client that
// replays an id — an autosave retry, a duplicated draft — must not rewrite a
// different match's moment.
func TestCoachNoteMoments_AnIDCollisionDoesNotCrossMatches(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			p := ensurePlayer(t, s, "", "Sable")
			first, err := s.UpsertCoachNote(db.CoachNote{PlayerRef: p.ID, MatchKey: coachKey, Kind: "note", Text: "x"})
			mustNoErr(t, err)
			second, err := s.UpsertCoachNote(db.CoachNote{PlayerRef: p.ID, MatchKey: coachOtherKey, Kind: "note", Text: "x"})
			mustNoErr(t, err)

			const shared = "collide"
			_, err = s.UpsertCoachNoteMoment(p.ID, db.CoachNoteMoment{
				MomentID: shared, NoteID: first.NoteID, MatchClock: "03:23", Text: "match one",
			})
			mustNoErr(t, err)
			_, err = s.UpsertCoachNoteMoment(p.ID, db.CoachNoteMoment{
				MomentID: shared, NoteID: second.NoteID, MatchClock: "09:59", Text: "match two",
			})
			mustNoErr(t, err)

			byNote, err := s.LoadCoachNoteMoments(p.ID)
			mustNoErr(t, err)
			if got := byNote[first.NoteID]; len(got) != 1 || got[0].Text != "match one" {
				t.Fatalf("match one's moment was rewritten: %+v", got)
			}
			if got := byNote[second.NoteID]; len(got) != 1 || got[0].Text != "match two" {
				t.Fatalf("match two lost its moment: %+v", got)
			}
		})
	}
}

// An edit keeps the position the coach wrote the moment at. Writing the list
// length on every save sent a moment to the bottom of its tied group the
// moment its typo was fixed — and since the wire carries only array order,
// the stored sort_order IS the visible order.
func TestCoachNoteMoments_AnEditKeepsItsPlace(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			p := ensurePlayer(t, s, "", "Sable")
			note, err := s.UpsertCoachNote(db.CoachNote{PlayerRef: p.ID, MatchKey: coachKey, Kind: "note", Text: "x"})
			mustNoErr(t, err)
			for i, text := range []string{"first", "second", "third"} {
				_, err := s.UpsertCoachNoteMoment(p.ID, db.CoachNoteMoment{
					MomentID: text, NoteID: note.NoteID, MatchClock: "04:45", Text: text, SortOrder: i,
				})
				mustNoErr(t, err)
			}

			// Fix a typo in the one written FIRST.
			_, err = s.UpsertCoachNoteMoment(p.ID, db.CoachNoteMoment{
				MomentID: "first", NoteID: note.NoteID, MatchClock: "04:45", Text: "first, corrected", SortOrder: 0,
			})
			mustNoErr(t, err)

			byNote, err := s.LoadCoachNoteMoments(p.ID)
			mustNoErr(t, err)
			got := byNote[note.NoteID]
			if len(got) != 3 || got[0].Text != "first, corrected" {
				t.Fatalf("an edit moved the moment out of place: %+v", got)
			}
		})
	}
}

// A block's moments read back in the order the accept computed — by SECONDS,
// which the stored sort_order encodes. Ordering on the clock STRING put
// "10:00" before "9:00", discarding that work, and the Fake could not see it
// because it returned insertion order.
func TestMatchCoachNoteMoments_ReadBackInReadingOrder(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			_, err := s.UpsertMatchCoachNote(db.MatchCoachNote{
				NoteID: "n1", MatchKey: coachKey, CoachName: "Ordo", SessionDate: "2026-08-15",
				Text: "x",
				Moments: []db.MatchCoachNoteMoment{
					{MomentID: "early", MatchClock: "09:00", Text: "earlier", SortOrder: 0},
					{MomentID: "late", MatchClock: "10:00", Text: "later", SortOrder: 1},
				},
			})
			mustNoErr(t, err)

			byMatch, err := s.LoadMatchCoachNotes()
			mustNoErr(t, err)
			blocks := byMatch[coachKey]
			if len(blocks) != 1 || len(blocks[0].Moments) != 2 {
				t.Fatalf("want one block with two moments, got %+v", blocks)
			}
			if blocks[0].Moments[0].MomentID != "early" {
				t.Fatalf("9:00 comes before 10:00; got %q first", blocks[0].Moments[0].MomentID)
			}
		})
	}
}

// The id comes from a file another machine wrote, so it is not a namespace to
// trust — and two rows sharing one collide as Vue keys downstream.
func TestMatchCoachNoteMoments_RefuseADuplicateIDInOneBlock(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			_, err := s.UpsertMatchCoachNote(db.MatchCoachNote{
				NoteID: "n1", MatchKey: coachKey, CoachName: "Ordo", SessionDate: "2026-08-15", Text: "x",
				Moments: []db.MatchCoachNoteMoment{
					{MomentID: "same", MatchClock: "03:23", Text: "one"},
					{MomentID: "same", MatchClock: "04:45", Text: "two"},
				},
			})
			if err == nil {
				t.Fatal("two moments sharing an id in one block must be refused")
			}
		})
	}
}
