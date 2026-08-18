package cmd_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"recall/pkg/coach"
	"recall/pkg/db/dbtest"
)

// The player's side of the loop over HTTP: a coach's notes archive comes
// back through POST /imports, stages as a return sheet, and each note is
// accepted or skipped through PUT /coach/returns/{id}/decisions. Accepting
// writes the coach's block onto the match, which the journal removes one at
// a time through DELETE /matches/{match_key}/coach-notes/{id}.

const (
	returnsPath          = "/api/v1/coach/returns"
	coachingSettingsPath = "/api/v1/settings/coaching"
)

// returnSheet is the wire shape GET /coach/returns renders, narrowed to
// what these tests assert on.
type returnSheet struct {
	ID           int64  `json:"id"`
	CoachName    string `json:"coach_name"`
	PlayerHandle string `json:"player_handle"`
	Pending      int    `json:"pending"`
	Notes        []struct {
		NoteID string `json:"note_id"`
		Status string `json:"status"`
	} `json:"notes"`
	Decisions map[string]string `json:"decisions"`
}

// notesArchive packs a coach's notes file the way an export does: one
// written note on writtenKey, one reviewed-only mark on reviewedKey.
func notesArchive(t *testing.T, writtenKey, reviewedKey string) []byte {
	t.Helper()
	now := time.Now().UTC()
	file := coach.NotesFile{
		Schema:        coach.NotesSchemaV1,
		ExportedAt:    now.Format(time.RFC3339),
		RecallVersion: "test",
		CoachName:     "Ordo",
		Player:        coach.Player{Handle: "Sable"},
		SessionDate:   now.Format(time.DateOnly),
		Summary:       "Ult economy first, positioning second.",
		Notes: []coach.Note{
			{
				NoteID: coach.NewID(), MatchKey: writtenKey, Kind: coach.KindNote,
				Text: "Late peel on B — hold high ground.", FocusTags: []string{"positioning"},
				ExtraTags: []string{}, MatchClock: "06:40", UpdatedAt: now.Format(time.RFC3339),
			},
			{
				NoteID: coach.NewID(), MatchKey: reviewedKey, Kind: coach.KindReviewedOnly,
				FocusTags: []string{}, ExtraTags: []string{}, UpdatedAt: now.Format(time.RFC3339),
			},
		},
	}
	payload, err := coach.WriteNotesArchive(file, now)
	if err != nil {
		t.Fatalf("write notes archive: %v", err)
	}
	return payload
}

// stageReturn imports a notes archive about two matches the player already
// has, and returns the staged sheet.
func stageReturn(t *testing.T, mux *http.ServeMux, fs *dbtest.Fake) returnSheet {
	t.Helper()
	seedMatchKeys(fs, sessionMatch1, sessionMatch2)
	rec := postBytes(t, mux, "/api/v1/imports", notesArchive(t, sessionMatch1, sessionMatch2))
	if rec.Code != http.StatusOK {
		t.Fatalf("import status = %d, want 200; body=%q", rec.Code, rec.Body.String())
	}
	var outcome struct {
		Kind     string      `json:"kind"`
		Imported int         `json:"imported"`
		Return   returnSheet `json:"return"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &outcome); err != nil {
		t.Fatalf("decode import outcome %q: %v", rec.Body.String(), err)
	}
	if outcome.Kind != "coach_notes" {
		t.Fatalf("import outcome kind = %q, want coach_notes", outcome.Kind)
	}
	return outcome.Return
}

func decodeSheet(t *testing.T, body []byte) returnSheet {
	t.Helper()
	var sheet returnSheet
	if err := json.Unmarshal(body, &sheet); err != nil {
		t.Fatalf("decode return sheet %q: %v", body, err)
	}
	return sheet
}

// A bundle import still reports its counts under the widened outcome
// shape — the same endpoint answers both archives, told apart by their
// entry names.
func TestImports_BundleStillReportsCountsUnderTheOutcomeShape(t *testing.T) {
	_, mux := newTestApp(t, nil)
	payload := buildBundle(t, "recall-bundle/v1", "recall-export/v1", []bundleSummary{
		{Filename: "a.png", MatchKey: "match-A"},
	})
	rec := postBytes(t, mux, "/api/v1/imports", payload)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%q", rec.Code, rec.Body.String())
	}
	var outcome struct {
		Kind     string `json:"kind"`
		Imported int    `json:"imported"`
		Skipped  int    `json:"skipped"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &outcome); err != nil {
		t.Fatalf("decode outcome: %v", err)
	}
	if outcome.Kind != "bundle" || outcome.Imported != 1 || outcome.Skipped != 0 {
		t.Fatalf("outcome = %+v, want {bundle 1 0}", outcome)
	}
}

func TestCoachReturns_StageThenListAndRead(t *testing.T) {
	fs, mux := newCoachMux(t)
	staged := stageReturn(t, mux, fs)
	if staged.CoachName != "Ordo" || staged.Pending != 2 {
		t.Fatalf("staged sheet = %+v, want Ordo with 2 pending", staged)
	}

	rec := get(t, mux, returnsPath)
	if rec.Code != http.StatusOK {
		t.Fatalf("list status = %d, want 200; body=%q", rec.Code, rec.Body.String())
	}
	var sheets []returnSheet
	if err := json.Unmarshal(rec.Body.Bytes(), &sheets); err != nil {
		t.Fatalf("decode sheets: %v", err)
	}
	if len(sheets) != 1 || sheets[0].ID != staged.ID {
		t.Fatalf("inbox = %+v, want the one staged sheet", sheets)
	}
	one := get(t, mux, returnsPath+"/"+strconv.FormatInt(staged.ID, 10))
	if one.Code != http.StatusOK {
		t.Fatalf("read status = %d, want 200; body=%q", one.Code, one.Body.String())
	}
}

func TestCoachReturns_UnknownIs404AndUnparsableIdIs400(t *testing.T) {
	_, mux := newCoachMux(t)
	if rec := get(t, mux, returnsPath+"/404"); rec.Code != http.StatusNotFound {
		t.Errorf("unknown id status = %d, want 404; body=%q", rec.Code, rec.Body.String())
	}
	if rec := del(t, mux, returnsPath+"/404"); rec.Code != http.StatusNotFound {
		t.Errorf("delete unknown id status = %d, want 404; body=%q", rec.Code, rec.Body.String())
	}
	if rec := get(t, mux, returnsPath+"/seven"); rec.Code != http.StatusBadRequest {
		t.Errorf("unparsable id status = %d, want 400; body=%q", rec.Code, rec.Body.String())
	}
}

// The decisions body is a PARTIAL map keyed by note_id: the player decides
// one card at a time and the sheet comes back recomputed.
func TestCoachReturnDecisions_AcceptAndSkipRecomputeTheSheet(t *testing.T) {
	fs, mux := newCoachMux(t)
	staged := stageReturn(t, mux, fs)
	written, reviewed := staged.Notes[0].NoteID, staged.Notes[1].NoteID
	path := returnsPath + "/" + strconv.FormatInt(staged.ID, 10) + "/decisions"

	rec := put(t, mux, path, map[string]any{"decisions": map[string]string{written: "accepted"}})
	if rec.Code != http.StatusOK {
		t.Fatalf("first decision status = %d, want 200; body=%q", rec.Code, rec.Body.String())
	}
	if sheet := decodeSheet(t, rec.Body.Bytes()); sheet.Pending != 1 || sheet.Decisions[written] != "accepted" {
		t.Fatalf("sheet after one accept = %+v, want 1 pending", sheet)
	}
	rec = put(t, mux, path, map[string]any{"decisions": map[string]string{reviewed: "skipped"}})
	if sheet := decodeSheet(t, rec.Body.Bytes()); sheet.Pending != 0 {
		t.Fatalf("sheet after both = %+v, want 0 pending", sheet)
	}
}

func TestCoachReturnDecisions_RejectsUnknownNoteAndBadVerdict(t *testing.T) {
	fs, mux := newCoachMux(t)
	staged := stageReturn(t, mux, fs)
	path := returnsPath + "/" + strconv.FormatInt(staged.ID, 10) + "/decisions"

	cases := []struct {
		name string
		body any
	}{
		{"unknown note", map[string]any{"decisions": map[string]string{coach.NewID(): "accepted"}}},
		{"bad verdict", map[string]any{"decisions": map[string]string{staged.Notes[0].NoteID: "maybe"}}},
		{"missing decisions", map[string]any{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if rec := put(t, mux, path, tc.body); rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body=%q", rec.Code, rec.Body.String())
			}
		})
	}
}

// Accepting a note writes the coach's block onto the match — it surfaces
// on GET /matches as `coach_notes[]` and the journal removes it by id.
func TestMatchCoachNotes_AcceptedBlockSurfacesThenDeletes(t *testing.T) {
	fs, mux := newCoachMux(t)
	staged := stageReturn(t, mux, fs)
	written := staged.Notes[0].NoteID
	_ = put(t, mux, returnsPath+"/"+strconv.FormatInt(staged.ID, 10)+"/decisions",
		map[string]any{"decisions": map[string]string{written: "accepted"}})

	blocks := coachNotesOnMatch(t, mux, sessionMatch1)
	if len(blocks) != 1 || blocks[0].NoteID != written {
		t.Fatalf("coach_notes on %s = %+v, want the accepted block", sessionMatch1, blocks)
	}
	path := "/api/v1/matches/" + sessionMatch1 + "/coach-notes/" + strconv.FormatInt(blocks[0].ID, 10)
	if rec := del(t, mux, path); rec.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d, want 204; body=%q", rec.Code, rec.Body.String())
	}
	if blocks := coachNotesOnMatch(t, mux, sessionMatch1); len(blocks) != 0 {
		t.Fatalf("block survived the delete: %+v", blocks)
	}
	// A note id that isn't on that match is a 404, never a delete of
	// somebody else's row.
	if rec := del(t, mux, path); rec.Code != http.StatusNotFound {
		t.Fatalf("second delete status = %d, want 404; body=%q", rec.Code, rec.Body.String())
	}
}

type coachBlock struct {
	ID     int64  `json:"id"`
	NoteID string `json:"note_id"`
}

// coachNotesOnMatch reads one match's coach_notes layer off GET /matches.
func coachNotesOnMatch(t *testing.T, mux *http.ServeMux, matchKey string) []coachBlock {
	t.Helper()
	rec := get(t, mux, "/api/v1/matches")
	var records []struct {
		MatchKey   string       `json:"match_key"`
		CoachNotes []coachBlock `json:"coach_notes"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &records); err != nil {
		t.Fatalf("decode matches %q: %v", rec.Body.String(), err)
	}
	for _, r := range records {
		if r.MatchKey == matchKey {
			return r.CoachNotes
		}
	}
	t.Fatalf("match %s absent from GET /matches: %s", matchKey, rec.Body.String())
	return nil
}

func TestCoachReturn_DeleteDropsTheSheet(t *testing.T) {
	fs, mux := newCoachMux(t)
	staged := stageReturn(t, mux, fs)
	if rec := del(t, mux, returnsPath+"/"+strconv.FormatInt(staged.ID, 10)); rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204; body=%q", rec.Code, rec.Body.String())
	}
	var sheets []returnSheet
	if err := json.Unmarshal(get(t, mux, returnsPath).Body.Bytes(), &sheets); err != nil {
		t.Fatalf("decode inbox: %v", err)
	}
	if len(sheets) != 0 {
		t.Fatalf("inbox still holds %d sheets", len(sheets))
	}
}

func TestCoachingSettings_GetIsEmptyUntilPut(t *testing.T) {
	_, mux := newCoachMux(t)
	if got := coachName(t, get(t, mux, coachingSettingsPath)); got != "" {
		t.Fatalf("initial coach_name = %q, want empty", got)
	}
	rec := put(t, mux, coachingSettingsPath, map[string]any{
		"coach_name": "  Ordo  ", "player_handle": "  Sable  ",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("put status = %d, want 200; body=%q", rec.Code, rec.Body.String())
	}
	if got := coachName(t, rec); got != "Ordo" {
		t.Errorf("echoed coach_name = %q, want the trimmed name", got)
	}
	if got := coachName(t, get(t, mux, coachingSettingsPath)); got != "Ordo" {
		t.Errorf("persisted coach_name = %q, want Ordo", got)
	}
	if got := playerHandle(t, get(t, mux, coachingSettingsPath)); got != "Sable" {
		t.Errorf("persisted player_handle = %q, want Sable", got)
	}
}

func TestCoachingSettings_RejectsNonStringName(t *testing.T) {
	_, mux := newCoachMux(t)
	rec := putRaw(t, mux, coachingSettingsPath, `{"coach_name": 7, "player_handle": ""}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%q", rec.Code, rec.Body.String())
	}
}

// Both fields are required rather than optional, because an omitted string is
// indistinguishable from an empty one after decoding: a half-body would mean
// "clear the field I did not mention", which is nobody's intent.
func TestCoachingSettings_RejectsAHalfBody(t *testing.T) {
	_, mux := newCoachMux(t)
	for _, body := range []string{`{"coach_name": "Ordo"}`, `{"player_handle": "Sable"}`, `{}`} {
		rec := putRaw(t, mux, coachingSettingsPath, body)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("put %s status = %d, want 400; body=%q", body, rec.Code, rec.Body.String())
		}
	}
}

func playerHandle(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var got struct {
		PlayerHandle string `json:"player_handle"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode coaching settings %q: %v", rec.Body.String(), err)
	}
	return got.PlayerHandle
}

func coachName(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var got struct {
		CoachName string `json:"coach_name"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode coaching settings %q: %v", rec.Body.String(), err)
	}
	return got.CoachName
}
