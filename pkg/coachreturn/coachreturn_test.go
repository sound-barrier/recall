package coachreturn_test

import (
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"recall/pkg/coach"
	"recall/pkg/coachreturn"
	"recall/pkg/db"
	"recall/pkg/db/dbtest"
)

var _ coachreturn.Store = (*dbtest.Fake)(nil)

func TestStage_BuildsTheSheet(t *testing.T) {
	st := seededStore(t)
	sheet := stageReturn(t, st, returnedNotes(t), "Sable")

	if sheet.ID == 0 || sheet.ImportedAt == "" {
		t.Fatalf("the store stamped no id/imported_at: %+v", sheet)
	}
	if want := wantStagedSheet(sheet.ID, sheet.ImportedAt); !reflect.DeepEqual(sheet, want) {
		t.Errorf("sheet = %s\nwant  = %s", asJSON(t, sheet), asJSON(t, want))
	}
	returns, err := st.LoadCoachReturns()
	if err != nil {
		t.Fatalf("LoadCoachReturns: %v", err)
	}
	if len(returns) != 1 || returns[0].ID != sheet.ID || returns[0].ContentHash == "" {
		t.Errorf("staged returns = %+v", returns)
	}
}

func TestStage_WireShape(t *testing.T) {
	sheet := stageReturn(t, seededStore(t), returnedNotes(t), "")
	b, err := json.Marshal(sheet)
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{`"id":`, `"coach_name":"Ordo"`, `"player_handle":"Sable"`, `"session_date":"2026-08-15"`, `"imported_at":`, `"focus_items":[{`, `"notes":[{`, `"decisions":{}`, `"pending":2`, `"player_mismatch":false`,
		`"note_id":"` + noteIDOne + `"`, `"match_key":"` + keyIlios + `"`, `"kind":"note"`, `"focus_tags":["positioning"]`, `"extra_tags":[]`, `"match_clock":"06:40"`, `"match":{"map":"ilios"`, `"status":"pending"`, `"status":"orphan"`} {
		if !strings.Contains(string(b), key) {
			t.Errorf("sheet JSON lacks %s: %s", key, b)
		}
	}
	if strings.Contains(string(b), "null") {
		t.Errorf("sheet JSON carries a null: %s", b)
	}
}

func TestStage_PlayerMismatch(t *testing.T) {
	tests := []struct {
		name  string
		local string
		want  bool
	}{
		{"the file's own handle", "Sable", false},
		{"a different case", "sable", false},
		{"padded and shouted", "  SABLE ", false},
		{"no local handle", "", false},
		{"someone else", "Wren", true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			st := seededStore(t)
			sheet := stageReturn(t, st, returnedNotes(t), tc.local)
			if sheet.PlayerMismatch != tc.want {
				t.Errorf("localHandle %q: PlayerMismatch = %v, want %v", tc.local, sheet.PlayerMismatch, tc.want)
			}
			got, err := coachreturn.Get(st, sheet.ID, tc.local)
			if err != nil || got.PlayerMismatch != tc.want {
				t.Errorf("Sheet(%q): mismatch=%v err=%v", tc.local, got.PlayerMismatch, err)
			}
		})
	}
}

func TestStage_SameFileTwiceIsTheSameSheet(t *testing.T) {
	st := seededStore(t)
	payload := returnedNotes(t)
	first := stageReturn(t, st, payload, "Sable")
	decide(t, st, first.ID, coachreturn.Verdict{NoteID: noteIDOne, Decision: coachreturn.DecisionAccepted})
	again, already, err := coachreturn.Stage(st, payload, "Sable", noMatchMaker)
	if err != nil {
		t.Fatalf("Stage again: %v", err)
	}
	if !already || again.ID != first.ID {
		t.Errorf("second Stage: already=%v id=%d, want the first sheet %d", already, again.ID, first.ID)
	}
	if again.Decisions[noteIDOne] != "accepted" || statusesOf(again)[noteIDOne] != "accepted" {
		t.Errorf("re-staging lost the decisions: %+v", again)
	}
	returns, _ := st.LoadCoachReturns()
	if len(returns) != 1 {
		t.Errorf("staged returns = %d, want 1", len(returns))
	}
}

// A coach can end a session having written only the focus list —
// ExportNotes allows it deliberately — so the player must be able to stage
// that file even though it names no match at all.
func TestStage_AcceptsFocusItemsWithNoNotes(t *testing.T) {
	st := dbtest.New()
	sheet := stageReturn(t, st, summaryOnlyNotes(t), "Sable")
	if len(sheet.FocusItems) != 1 || sheet.FocusItems[0].Text != "Work on ult timing." {
		t.Errorf("focus items = %+v, want the file's", sheet.FocusItems)
	}
	if len(sheet.Notes) != 0 || sheet.Pending != 0 {
		t.Errorf("sheet = %+v, want no notes and nothing pending", sheet)
	}
	if returns, _ := st.LoadCoachReturns(); len(returns) != 1 {
		t.Errorf("staged returns = %d, want the items-only file staged", len(returns))
	}
}

// The summary is what makes a file about matches the player lacks worth
// keeping; without one there is nothing to show, and the refusal says which
// of the two empty cases it is.
func TestStage_RefusesAFileWithNothingToShow(t *testing.T) {
	tests := []struct {
		name    string
		payload []byte
		want    string
	}{
		{"notes about matches the player lacks", unmatchedNotes(t), "none of its 2 notes name a match you have"},
		{"neither notes nor items", emptyNotes(t), "no notes and nothing to work on"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			st := dbtest.New()
			_, _, err := coachreturn.Stage(st, tc.payload, "Sable", noMatchMaker)
			if !errors.Is(err, coachreturn.ErrNoMatches) {
				t.Fatalf("err = %v, want ErrNoMatches", err)
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Errorf("refusal = %q, want it to name %q", err, tc.want)
			}
			if returns, _ := st.LoadCoachReturns(); len(returns) != 0 {
				t.Error("a refused file was staged anyway")
			}
		})
	}
}

func TestStage_RefusesWhatItCannotRead(t *testing.T) {
	st := seededStore(t)
	for name, payload := range map[string][]byte{
		"a share bundle": zipWithEntries(t, map[string][]byte{
			"manifest.json": []byte(`{"schema":"recall-export/v4"}`),
			"data.json":     []byte(`{}`),
		}),
		"garbage": []byte("nope"),
	} {
		if _, _, err := coachreturn.Stage(st, payload, "", noMatchMaker); !errors.Is(err, coach.ErrNotesMalformed) {
			t.Errorf("%s: err = %v, want ErrNotesMalformed", name, err)
		}
	}
	unsupported := validNotesFile()
	unsupported.Schema = "recall-coach-notes/v9"
	body, _ := json.Marshal(unsupported)
	if _, _, err := coachreturn.Stage(st, zipWithEntries(t, map[string][]byte{"notes.json": body}), "", noMatchMaker); !errors.Is(err, coach.ErrNotesUnsupportedSchema) {
		t.Errorf("unsupported schema: err = %v", err)
	}
}

func TestSheet_UnknownReturn(t *testing.T) {
	if _, err := coachreturn.Get(dbtest.New(), 99, ""); !errors.Is(err, db.ErrCoachReturnUnknown) {
		t.Errorf("Sheet(99) err = %v, want db.ErrCoachReturnUnknown", err)
	}
	if _, err := coachreturn.Decide(dbtest.New(), 99, nil, "Sable", noMatchMaker); !errors.Is(err, db.ErrCoachReturnUnknown) {
		t.Errorf("Decide(99) err = %v, want db.ErrCoachReturnUnknown", err)
	}
}

func TestSheets_ListsEveryStagedReturn(t *testing.T) {
	st := seededStore(t)
	stageReturn(t, st, returnedNotes(t), "Sable")
	second := validNotesFile()
	second.CoachName = "Wren"
	second.Notes = second.Notes[:1]
	second.Notes[0].NoteID = coach.NewID()
	payload, err := coach.WriteNotesArchive(second, testSheet, nil, fixedNow)
	if err != nil {
		t.Fatalf("WriteNotesArchive: %v", err)
	}
	stageReturn(t, st, payload, "Sable")

	sheets, err := coachreturn.Sheets(st, "Sable")
	if err != nil {
		t.Fatalf("Sheets: %v", err)
	}
	pendingByCoach := map[string]int{}
	for _, s := range sheets {
		pendingByCoach[s.CoachName] = s.Pending
	}
	want := map[string]int{"Ordo": 2, "Wren": 1}
	if !reflect.DeepEqual(pendingByCoach, want) {
		t.Errorf("pending by coach = %v, want %v", pendingByCoach, want)
	}
	if len(sheets) != len(want) {
		t.Errorf("Sheets = %d sheets, want %d", len(sheets), len(want))
	}
}

func TestSheets_EmptyStoreIsAnEmptySlice(t *testing.T) {
	got, err := coachreturn.Sheets(dbtest.New(), "")
	if err != nil {
		t.Fatalf("Sheets: %v", err)
	}
	if got == nil || len(got) != 0 {
		t.Errorf("Sheets(empty store) = %v, want a non-nil empty slice", got)
	}
}

func TestDecide_AcceptANoteWritesTheBlockAndReviews(t *testing.T) {
	st := seededStore(t)
	sheet := stageReturn(t, st, returnedNotes(t), "Sable")
	if st.Reviews[keyIlios].ReviewedBy != "self" {
		t.Fatal("fixture: Ilios should start reviewed by self")
	}
	got := decide(t, st, sheet.ID, coachreturn.Verdict{NoteID: noteIDOne, Decision: coachreturn.DecisionAccepted})

	block := blockWithNoteID(t, st, keyIlios, noteIDOne)
	if block.AcceptedAt == "" {
		t.Error("accepted_at not stamped")
	}
	// The store reads an empty tag list back as nil (its documented shape).
	want := db.MatchCoachNote{ID: block.ID, NoteID: noteIDOne, MatchKey: keyIlios, CoachName: "Ordo", SessionDate: "2026-08-15", Text: "hold high ground", MatchClock: "06:40", FocusTags: []string{"positioning"}, AcceptedAt: block.AcceptedAt}
	if !reflect.DeepEqual(block, want) {
		t.Errorf("block = %+v\nwant  %+v", block, want)
	}
	if st.Reviews[keyIlios].ReviewedBy != "coach" {
		t.Errorf("reviewed_by = %q, want coach to overwrite self", st.Reviews[keyIlios].ReviewedBy)
	}
	wantState := decisionState{
		Statuses: map[string]coachreturn.Status{
			noteIDOne:    coachreturn.StatusAccepted,
			noteIDTwo:    coachreturn.StatusPending,
			orphanNoteID: coachreturn.StatusOrphan,
		},
		Decisions: map[string]string{noteIDOne: string(coachreturn.DecisionAccepted)},
		Pending:   1,
	}
	if state := stateOf(got); !reflect.DeepEqual(state, wantState) {
		t.Errorf("sheet after accept = %+v, want %+v", state, wantState)
	}
}

func TestDecide_AcceptReviewedOnlySetsOnlyTheFlag(t *testing.T) {
	st := seededStore(t)
	sheet := stageReturn(t, st, returnedNotes(t), "Sable")
	got := decide(t, st, sheet.ID, coachreturn.Verdict{NoteID: noteIDTwo, Decision: coachreturn.DecisionAccepted})
	if st.Reviews[keyRank].ReviewedBy != "coach" {
		t.Errorf("reviewed_by = %q, want coach", st.Reviews[keyRank].ReviewedBy)
	}
	blocks, _ := st.LoadMatchCoachNotes()
	if len(blocks[keyRank]) != 0 {
		t.Errorf("a reviewed_only accept wrote a block: %+v", blocks[keyRank])
	}
	if statusesOf(got)[noteIDTwo] != "accepted" {
		t.Errorf("status = %q", statusesOf(got)[noteIDTwo])
	}
}

func TestDecide_SkipAfterAcceptDeletesTheBlock(t *testing.T) {
	st := seededStore(t)
	sheet := stageReturn(t, st, returnedNotes(t), "Sable")
	decide(t, st, sheet.ID, coachreturn.Verdict{NoteID: noteIDOne, Decision: coachreturn.DecisionAccepted})
	got := decide(t, st, sheet.ID, coachreturn.Verdict{NoteID: noteIDOne, Decision: coachreturn.DecisionSkipped})

	if ids := noteIDsOf(blocksOn(t, st, keyIlios)); !reflect.DeepEqual(ids, []string{receivedNoteID}) {
		t.Errorf("blocks on Ilios = %v, want only the earlier coach's %s", ids, receivedNoteID)
	}
	wantSkipped := decisionState{
		Statuses:  map[string]coachreturn.Status{noteIDOne: coachreturn.StatusSkipped, noteIDTwo: coachreturn.StatusPending, orphanNoteID: coachreturn.StatusOrphan},
		Decisions: map[string]string{noteIDOne: string(coachreturn.DecisionSkipped)},
		Pending:   1,
	}
	if state := stateOf(got); !reflect.DeepEqual(state, wantSkipped) {
		t.Errorf("sheet after skip = %+v, want %+v", state, wantSkipped)
	}

	// Skipping a note that was never accepted is a plain decision.
	got = decide(t, st, sheet.ID, coachreturn.Verdict{NoteID: noteIDTwo, Decision: coachreturn.DecisionSkipped})
	wantBothSkipped := decisionState{
		Statuses:  map[string]coachreturn.Status{noteIDOne: coachreturn.StatusSkipped, noteIDTwo: coachreturn.StatusSkipped, orphanNoteID: coachreturn.StatusOrphan},
		Decisions: map[string]string{noteIDOne: string(coachreturn.DecisionSkipped), noteIDTwo: string(coachreturn.DecisionSkipped)},
		Pending:   0,
	}
	if state := stateOf(got); !reflect.DeepEqual(state, wantBothSkipped) {
		t.Errorf("sheet after the second skip = %+v, want %+v", state, wantBothSkipped)
	}
}

// Skipping a note about a match the player no longer has is the only way to
// dismiss it, and "Skip all" sends every note on the sheet in one batch — so
// refusing the orphan would throw every other verdict away with it.
func TestDecide_SkipsAnOrphanWithTheRestOfTheBatch(t *testing.T) {
	st := seededStore(t)
	sheet := stageReturn(t, st, returnedNotes(t), "Sable")
	got := decide(t, st, sheet.ID,
		coachreturn.Verdict{NoteID: noteIDOne, Decision: coachreturn.DecisionAccepted},
		coachreturn.Verdict{NoteID: noteIDTwo, Decision: coachreturn.DecisionSkipped},
		coachreturn.Verdict{NoteID: orphanNoteID, Decision: coachreturn.DecisionSkipped},
	)
	want := decisionState{
		Statuses: map[string]coachreturn.Status{
			noteIDOne: coachreturn.StatusAccepted, noteIDTwo: coachreturn.StatusSkipped, orphanNoteID: coachreturn.StatusOrphan,
		},
		Decisions: map[string]string{
			noteIDOne: string(coachreturn.DecisionAccepted), noteIDTwo: string(coachreturn.DecisionSkipped), orphanNoteID: string(coachreturn.DecisionSkipped),
		},
		Pending: 0,
	}
	if state := stateOf(got); !reflect.DeepEqual(state, want) {
		t.Errorf("sheet after the batch = %+v, want %+v", state, want)
	}
}

// Accepting an orphan stays refused: the accept would write a block for a
// match this database has never seen.
func TestDecide_StillRefusesToAcceptAnOrphan(t *testing.T) {
	st := seededStore(t)
	sheet := stageReturn(t, st, returnedNotes(t), "Sable")
	_, err := coachreturn.Decide(st, sheet.ID, []coachreturn.Verdict{{NoteID: orphanNoteID, Decision: coachreturn.DecisionAccepted}}, "Sable", noMatchMaker)
	if !errors.Is(err, coachreturn.ErrOrphan) {
		t.Fatalf("err = %v, want ErrOrphan", err)
	}
	if blocks, _ := st.LoadMatchCoachNotes(); len(blocks[orphanKey]) != 0 {
		t.Errorf("a refused accept wrote a block on %s: %+v", orphanKey, blocks[orphanKey])
	}
}

func TestDecide_IsPartialAndRepeatable(t *testing.T) {
	st := seededStore(t)
	sheet := stageReturn(t, st, returnedNotes(t), "Sable")
	for range 3 {
		got := decide(t, st, sheet.ID, coachreturn.Verdict{NoteID: noteIDOne, Decision: coachreturn.DecisionAccepted})
		if statusesOf(got)[noteIDTwo] != coachreturn.StatusPending || got.Pending != 1 {
			t.Errorf("an undecided note changed state: %v", statusesOf(got))
		}
	}
	ids := noteIDsOf(blocksOn(t, st, keyIlios))
	if want := []string{receivedNoteID, noteIDOne}; !reflect.DeepEqual(ids, want) {
		t.Errorf("repeat accepts left %v, want %v — one block per note_id", ids, want)
	}
	if got := decide(t, st, sheet.ID); got.Pending != 1 {
		t.Errorf("Decide with no decisions: pending=%d", got.Pending)
	}
}

func TestDecide_RejectsBeforeWritingAnything(t *testing.T) {
	tests := []struct {
		name string
		bad  coachreturn.Verdict
		want error
	}{
		{"orphan", coachreturn.Verdict{NoteID: orphanNoteID, Decision: "accepted"}, coachreturn.ErrOrphan},
		{"unknown note", coachreturn.Verdict{NoteID: coach.NewID(), Decision: "accepted"}, coach.ErrNoteInvalid},
		{"unknown decision", coachreturn.Verdict{NoteID: noteIDOne, Decision: "maybe"}, coach.ErrNoteInvalid},
		{"empty decision", coachreturn.Verdict{NoteID: noteIDOne}, coach.ErrNoteInvalid},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			st := seededStore(t)
			sheet := stageReturn(t, st, returnedNotes(t), "Sable")
			_, err := coachreturn.Decide(st, sheet.ID, []coachreturn.Verdict{{NoteID: noteIDTwo, Decision: "accepted"}, tc.bad}, "Sable", noMatchMaker)
			if !errors.Is(err, tc.want) {
				t.Fatalf("err = %v, want %v", err, tc.want)
			}
			after, _ := coachreturn.Get(st, sheet.ID, "Sable")
			if after.Pending != 2 || st.Reviews[keyRank].ReviewedBy != "" {
				t.Errorf("a rejected batch was partly applied: pending=%d review=%q", after.Pending, st.Reviews[keyRank].ReviewedBy)
			}
		})
	}
}

// Status precedence: orphan beats a decision row; an existing block (or a
// coach review for a reviewed_only mark) reads as accepted with no
// decision row at all — the case after a bundle restore carried the block.
func TestSheet_StatusPrecedence(t *testing.T) {
	st := seededStore(t)
	sheet := stageReturn(t, st, returnedNotes(t), "Sable")
	decide(t, st, sheet.ID, coachreturn.Verdict{NoteID: noteIDOne, Decision: coachreturn.DecisionAccepted})
	// The player hard-deletes Ilios: its key is gone from history.
	if err := st.HardDeleteMatch(keyIlios); err != nil {
		t.Fatal(err)
	}
	got, err := coachreturn.Get(st, sheet.ID, "Sable")
	if err != nil {
		t.Fatal(err)
	}
	if statusesOf(got)[noteIDOne] != "orphan" {
		t.Errorf("a decided note whose match is gone = %q, want orphan", statusesOf(got)[noteIDOne])
	}

	// A fresh store where the block already exists (restored) and the rank
	// match is already coach-reviewed: both read accepted with no decisions.
	st2 := seededStore(t)
	st2.MatchCoachNotes = append(st2.MatchCoachNotes, db.MatchCoachNote{ID: 2, NoteID: noteIDOne, MatchKey: keyIlios, CoachName: "Ordo", SessionDate: "2026-08-15", Text: "hold high ground", AcceptedAt: "2026-08-15T00:00:00Z"})
	st2.Reviews[keyRank] = db.ReviewState{ReviewedBy: "coach", ReviewedAt: "2026-08-15T00:00:00Z"}
	sheet2 := stageReturn(t, st2, returnedNotes(t), "Sable")
	want := map[string]coachreturn.Status{
		noteIDOne: coachreturn.StatusAccepted, noteIDTwo: coachreturn.StatusAccepted,
		orphanNoteID: coachreturn.StatusOrphan,
	}
	if got := statusesOf(sheet2); !reflect.DeepEqual(got, want) {
		t.Errorf("statuses = %v, want %v", got, want)
	}
	if sheet2.Pending != 0 || len(sheet2.Decisions) != 0 {
		t.Errorf("pending=%d decisions=%v", sheet2.Pending, sheet2.Decisions)
	}
	// A reviewed_only mark on a SELF-reviewed match is still pending.
	st3 := seededStore(t)
	st3.Reviews[keyRank] = db.ReviewState{ReviewedBy: "self", ReviewedAt: "2026-08-15T00:00:00Z"}
	if s := statusesOf(stageReturn(t, st3, returnedNotes(t), "Sable")); s[noteIDTwo] != "pending" {
		t.Errorf("reviewed_only on a self-reviewed match = %q, want pending", s[noteIDTwo])
	}
}

func TestDecide_TwoCoachesAccumulateOnOneMatch(t *testing.T) {
	st := seededStore(t)
	ordo := stageReturn(t, st, returnedNotes(t), "Sable")
	wrenFile := validNotesFile()
	wrenFile.CoachName = "Wren"
	wrenFile.SessionDate = "2026-08-16"
	wrenFile.Notes = wrenFile.Notes[:1]
	wrenFile.Notes[0].NoteID = coach.NewID()
	wrenFile.Notes[0].Text = "peel earlier"
	payload, err := coach.WriteNotesArchive(wrenFile, testSheet, nil, fixedNow)
	if err != nil {
		t.Fatalf("WriteNotesArchive: %v", err)
	}
	wren := stageReturn(t, st, payload, "Sable")

	decide(t, st, ordo.ID, coachreturn.Verdict{NoteID: noteIDOne, Decision: coachreturn.DecisionAccepted})
	decide(t, st, wren.ID, coachreturn.Verdict{NoteID: wrenFile.Notes[0].NoteID, Decision: coachreturn.DecisionAccepted})

	blocks := blocksOn(t, st, keyIlios)
	if want := []string{receivedNoteID, noteIDOne, wrenFile.Notes[0].NoteID}; !reflect.DeepEqual(noteIDsOf(blocks), want) {
		t.Errorf("blocks on Ilios = %v, want %v", noteIDsOf(blocks), want)
	}
	if want := []string{"Prior", "Ordo", "Wren"}; !reflect.DeepEqual(coachNamesOf(blocks), want) {
		t.Errorf("coaches on Ilios = %v, want %v — blocks accumulate, one per coach", coachNamesOf(blocks), want)
	}
}

// A coach's items are live on arrival: staging puts them straight into the
// player's list as `new`. They are not decided on the way notes are —
// Accept only acknowledges one, and there is no deny.
func TestStage_LandsFocusItemsImmediately(t *testing.T) {
	st := dbtest.New()
	stageReturn(t, st, returnedNotes(t), "Sable")

	got, err := st.LoadReceivedFocusItems()
	if err != nil {
		t.Fatalf("LoadReceivedFocusItems: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("received items = %d, want the file's one", len(got))
	}
	if got[0].Text != "Work on ult timing." || got[0].Status != db.FocusNew {
		t.Errorf("item = %+v, want the file's text, status new", got[0])
	}
	if got[0].CoachName != "Ordo" || got[0].SessionDate != "2026-08-15" {
		t.Errorf("item = %+v, want it to carry who sent it and when", got[0])
	}
}

// Re-importing the same file must not undo progress the player has made.
func TestStage_ReimportKeepsAStatusThePlayerMoved(t *testing.T) {
	st := dbtest.New()
	stageReturn(t, st, returnedNotes(t), "Sable")
	items, _ := st.LoadReceivedFocusItems()
	if err := st.SetFocusItemStatus(items[0].ItemID, db.FocusDone); err != nil {
		t.Fatalf("SetFocusItemStatus: %v", err)
	}

	if _, already, err := coachreturn.Stage(st, returnedNotes(t), "Sable", noMatchMaker); err != nil || !already {
		t.Fatalf("second Stage = (already %v, %v), want (true, nil)", already, err)
	}

	again, _ := st.LoadReceivedFocusItems()
	if len(again) != 1 || again[0].Status != db.FocusDone {
		t.Errorf("items after re-import = %+v, want the one item still done", again)
	}
}

func TestDecide_AcceptKeepsAReviewedOnlyNotesMoments(t *testing.T) {
	st := seededStore(t)
	// The shape a moments-only review produces: reviewed_only, no text, every
	// observation hanging off it as a moment.
	f := validNotesFile()
	f.Notes[1].Moments = []coach.Moment{
		{MomentID: "m1", MatchClock: "03:23", Text: "no off-angle"},
		{MomentID: "m2", MatchClock: "04:45", Text: "flanking Cassidy"},
	}
	sheet := stageReturn(t, st, writeNotes(t, f), "Sable")

	decide(t, st, sheet.ID, coachreturn.Verdict{NoteID: noteIDTwo, Decision: coachreturn.DecisionAccepted})

	block := blockWithNoteID(t, st, f.Notes[1].MatchKey, noteIDTwo)
	if len(block.Moments) != 2 {
		t.Fatalf("a moments-only review lost its moments on accept: %+v", block)
	}
	if block.Moments[0].MatchClock != "03:23" {
		t.Errorf("moments should land in reading order, got %q first", block.Moments[0].MatchClock)
	}
}

// A TEAM notes file names the team, not the player. The mismatch warning
// exists to stop a stranger's homework landing on your list — but a file
// addressed to the team you play for is your coach talking to you, and
// treating it as somebody else's cost the captain every focus item in it.
func TestStage_ATeamFileIsNotAMismatch(t *testing.T) {
	st := seededStore(t)
	f := validNotesFile()
	f.Player.Handle = "Sound Barrier"
	f.Player.Kind = db.CoachKindTeam

	sheet := stageReturn(t, st, writeNotes(t, f), "Sable")

	if sheet.PlayerMismatch {
		t.Error("a team file read as a mismatch: the handle names the team, not the player")
	}
	// And the items land, which the mismatch would have silently prevented.
	items, err := st.LoadReceivedFocusItems()
	if err != nil {
		t.Fatalf("LoadReceivedFocusItems: %v", err)
	}
	if len(items) == 0 {
		t.Error("no focus items landed from the team file")
	}
}

// A PLAYER file addressed to somebody else still warns — the widening is
// about the team case only.
func TestStage_APlayerFileForSomebodyElseStillWarns(t *testing.T) {
	st := seededStore(t)
	f := validNotesFile()
	f.Player.Handle = "Wren"

	sheet := stageReturn(t, st, writeNotes(t, f), "Sable")

	if !sheet.PlayerMismatch {
		t.Error("a file about another PLAYER must still warn")
	}
}
