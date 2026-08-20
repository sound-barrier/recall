package coach_test

import (
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"recall/pkg/coach"
	"recall/pkg/db"
	"recall/pkg/db/dbtest"
)

var _ coach.ReturnStore = (*dbtest.Fake)(nil)

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
			got, err := coach.Sheet(st, sheet.ID, tc.local)
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
	decide(t, st, first.ID, coach.Decision{NoteID: noteIDOne, Decision: coach.DecisionAccepted})
	again, already, err := coach.Stage(st, payload, "Sable")
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
		{"neither notes nor summary", emptyNotes(t), "no notes and no summary"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			st := dbtest.New()
			_, _, err := coach.Stage(st, tc.payload, "Sable")
			if !errors.Is(err, coach.ErrReturnNoMatches) {
				t.Fatalf("err = %v, want ErrReturnNoMatches", err)
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
		"a bundle": exportBundle(t, seededStore(t), nil),
		"garbage":  []byte("nope"),
	} {
		if _, _, err := coach.Stage(st, payload, ""); !errors.Is(err, coach.ErrNotesMalformed) {
			t.Errorf("%s: err = %v, want ErrNotesMalformed", name, err)
		}
	}
	unsupported := validNotesFile()
	unsupported.Schema = "recall-coach-notes/v9"
	body, _ := json.Marshal(unsupported)
	if _, _, err := coach.Stage(st, zipWithEntries(t, map[string][]byte{"notes.json": body}), ""); !errors.Is(err, coach.ErrNotesUnsupportedSchema) {
		t.Errorf("unsupported schema: err = %v", err)
	}
}

func TestSheet_UnknownReturn(t *testing.T) {
	if _, err := coach.Sheet(dbtest.New(), 99, ""); !errors.Is(err, db.ErrCoachReturnUnknown) {
		t.Errorf("Sheet(99) err = %v, want db.ErrCoachReturnUnknown", err)
	}
	if _, err := coach.Decide(dbtest.New(), 99, nil, "Sable"); !errors.Is(err, db.ErrCoachReturnUnknown) {
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
	payload, err := coach.WriteNotesArchive(second, fixedNow)
	if err != nil {
		t.Fatalf("WriteNotesArchive: %v", err)
	}
	stageReturn(t, st, payload, "Sable")

	sheets, err := coach.Sheets(st, "Sable")
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
	got, err := coach.Sheets(dbtest.New(), "")
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
	got := decide(t, st, sheet.ID, coach.Decision{NoteID: noteIDOne, Decision: coach.DecisionAccepted})

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
		Statuses:  map[string]string{noteIDOne: coach.StatusAccepted, noteIDTwo: coach.StatusPending, orphanNoteID: coach.StatusOrphan},
		Decisions: map[string]string{noteIDOne: coach.DecisionAccepted},
		Pending:   1,
	}
	if state := stateOf(got); !reflect.DeepEqual(state, wantState) {
		t.Errorf("sheet after accept = %+v, want %+v", state, wantState)
	}
}

func TestDecide_AcceptReviewedOnlySetsOnlyTheFlag(t *testing.T) {
	st := seededStore(t)
	sheet := stageReturn(t, st, returnedNotes(t), "Sable")
	got := decide(t, st, sheet.ID, coach.Decision{NoteID: noteIDTwo, Decision: coach.DecisionAccepted})
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
	decide(t, st, sheet.ID, coach.Decision{NoteID: noteIDOne, Decision: coach.DecisionAccepted})
	got := decide(t, st, sheet.ID, coach.Decision{NoteID: noteIDOne, Decision: coach.DecisionSkipped})

	if ids := noteIDsOf(blocksOn(t, st, keyIlios)); !reflect.DeepEqual(ids, []string{receivedNoteID}) {
		t.Errorf("blocks on Ilios = %v, want only the earlier coach's %s", ids, receivedNoteID)
	}
	wantSkipped := decisionState{
		Statuses:  map[string]string{noteIDOne: coach.StatusSkipped, noteIDTwo: coach.StatusPending, orphanNoteID: coach.StatusOrphan},
		Decisions: map[string]string{noteIDOne: coach.DecisionSkipped},
		Pending:   1,
	}
	if state := stateOf(got); !reflect.DeepEqual(state, wantSkipped) {
		t.Errorf("sheet after skip = %+v, want %+v", state, wantSkipped)
	}

	// Skipping a note that was never accepted is a plain decision.
	got = decide(t, st, sheet.ID, coach.Decision{NoteID: noteIDTwo, Decision: coach.DecisionSkipped})
	wantBothSkipped := decisionState{
		Statuses:  map[string]string{noteIDOne: coach.StatusSkipped, noteIDTwo: coach.StatusSkipped, orphanNoteID: coach.StatusOrphan},
		Decisions: map[string]string{noteIDOne: coach.DecisionSkipped, noteIDTwo: coach.DecisionSkipped},
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
		coach.Decision{NoteID: noteIDOne, Decision: coach.DecisionAccepted},
		coach.Decision{NoteID: noteIDTwo, Decision: coach.DecisionSkipped},
		coach.Decision{NoteID: orphanNoteID, Decision: coach.DecisionSkipped},
	)
	want := decisionState{
		Statuses: map[string]string{
			noteIDOne: coach.StatusAccepted, noteIDTwo: coach.StatusSkipped, orphanNoteID: coach.StatusOrphan,
		},
		Decisions: map[string]string{
			noteIDOne: coach.DecisionAccepted, noteIDTwo: coach.DecisionSkipped, orphanNoteID: coach.DecisionSkipped,
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
	_, err := coach.Decide(st, sheet.ID, []coach.Decision{{NoteID: orphanNoteID, Decision: coach.DecisionAccepted}}, "Sable")
	if !errors.Is(err, coach.ErrReturnOrphan) {
		t.Fatalf("err = %v, want ErrReturnOrphan", err)
	}
	if blocks, _ := st.LoadMatchCoachNotes(); len(blocks[orphanKey]) != 0 {
		t.Errorf("a refused accept wrote a block on %s: %+v", orphanKey, blocks[orphanKey])
	}
}

func TestDecide_IsPartialAndRepeatable(t *testing.T) {
	st := seededStore(t)
	sheet := stageReturn(t, st, returnedNotes(t), "Sable")
	for range 3 {
		got := decide(t, st, sheet.ID, coach.Decision{NoteID: noteIDOne, Decision: coach.DecisionAccepted})
		if statusesOf(got)[noteIDTwo] != coach.StatusPending || got.Pending != 1 {
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
		bad  coach.Decision
		want error
	}{
		{"orphan", coach.Decision{NoteID: orphanNoteID, Decision: "accepted"}, coach.ErrReturnOrphan},
		{"unknown note", coach.Decision{NoteID: coach.NewID(), Decision: "accepted"}, coach.ErrNoteInvalid},
		{"unknown decision", coach.Decision{NoteID: noteIDOne, Decision: "maybe"}, coach.ErrNoteInvalid},
		{"empty decision", coach.Decision{NoteID: noteIDOne}, coach.ErrNoteInvalid},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			st := seededStore(t)
			sheet := stageReturn(t, st, returnedNotes(t), "Sable")
			_, err := coach.Decide(st, sheet.ID, []coach.Decision{{NoteID: noteIDTwo, Decision: "accepted"}, tc.bad}, "Sable")
			if !errors.Is(err, tc.want) {
				t.Fatalf("err = %v, want %v", err, tc.want)
			}
			after, _ := coach.Sheet(st, sheet.ID, "Sable")
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
	decide(t, st, sheet.ID, coach.Decision{NoteID: noteIDOne, Decision: coach.DecisionAccepted})
	// The player hard-deletes Ilios: its key is gone from history.
	if err := st.HardDeleteMatch(keyIlios); err != nil {
		t.Fatal(err)
	}
	got, err := coach.Sheet(st, sheet.ID, "Sable")
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
	want := map[string]string{noteIDOne: "accepted", noteIDTwo: "accepted", orphanNoteID: "orphan"}
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
	payload, err := coach.WriteNotesArchive(wrenFile, fixedNow)
	if err != nil {
		t.Fatalf("WriteNotesArchive: %v", err)
	}
	wren := stageReturn(t, st, payload, "Sable")

	decide(t, st, ordo.ID, coach.Decision{NoteID: noteIDOne, Decision: coach.DecisionAccepted})
	decide(t, st, wren.ID, coach.Decision{NoteID: wrenFile.Notes[0].NoteID, Decision: coach.DecisionAccepted})

	blocks := blocksOn(t, st, keyIlios)
	if want := []string{receivedNoteID, noteIDOne, wrenFile.Notes[0].NoteID}; !reflect.DeepEqual(noteIDsOf(blocks), want) {
		t.Errorf("blocks on Ilios = %v, want %v", noteIDsOf(blocks), want)
	}
	if want := []string{"Prior", "Ordo", "Wren"}; !reflect.DeepEqual(coachNamesOf(blocks), want) {
		t.Errorf("coaches on Ilios = %v, want %v — blocks accumulate, one per coach", coachNamesOf(blocks), want)
	}
}
