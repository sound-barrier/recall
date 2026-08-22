package coach_test

import (
	"encoding/json"
	"errors"
	"maps"
	"reflect"
	"slices"
	"strings"
	"testing"

	"recall/pkg/bundle"
	"recall/pkg/coach"
	"recall/pkg/match"
	"recall/pkg/parser"
)

// keyNotInBundle is a tracked key the seeded bundle never carried.
const keyNotInBundle = "match-2099-01-01T00-00-00"

func openSeededSession(t *testing.T, player *bundle.PlayerIdentity) *coach.Session {
	t.Helper()
	s, err := coach.OpenSession(exportBundle(t, seededStore(t), player), fixedNow)
	if err != nil {
		t.Fatalf("OpenSession: %v", err)
	}
	return s
}

// sessionIdentity is everything OpenSession reads off a bundle. ExportedAt
// is the bundle's own export instant rather than a fixed clock, so only
// whether it was carried across is assertable.
type sessionIdentity struct {
	Player            coach.Player
	HandleFromBundle  bool
	MatchCount        int
	ExportedAtStamped bool
	RecallVersion     string
	OpenedAt          string
}

func identityOf(s *coach.Session) sessionIdentity {
	return sessionIdentity{
		Player:            s.Player,
		HandleFromBundle:  s.HandleFromBundle,
		MatchCount:        s.MatchCount(),
		ExportedAtStamped: s.ExportedAt != "",
		RecallVersion:     s.RecallVersion,
		OpenedAt:          s.OpenedAt,
	}
}

func TestOpenSession_UsesTheBundleIdentity(t *testing.T) {
	got := identityOf(openSeededSession(t, sharePlayer()))
	want := sessionIdentity{
		Player:            coach.Player{ID: sharePlayer().ID, Handle: "Sable", Message: sharePlayer().Message},
		HandleFromBundle:  true,
		MatchCount:        4,
		ExportedAtStamped: true,
		RecallVersion:     seedVersion,
		OpenedAt:          "2026-08-15T09:12:00Z",
	}
	if got != want {
		t.Errorf("session = %+v\nwant       %+v", got, want)
	}
}

func TestSession_HasMatchIsExactlyTheBundle(t *testing.T) {
	s := openSeededSession(t, sharePlayer())
	got := map[string]bool{keyNotInBundle: s.HasMatch(keyNotInBundle)}
	for _, k := range seededKeys() {
		got[k] = s.HasMatch(k)
	}
	want := map[string]bool{keyManual: true, keyIlios: true, keyRank: true, keyUnknown: true, keyNotInBundle: false}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("HasMatch = %v, want %v", got, want)
	}
}

func TestSession_PlayerRefIsResolvedByTheApp(t *testing.T) {
	s := openSeededSession(t, sharePlayer())
	if s.PlayerRef() != 0 {
		t.Errorf("PlayerRef = %d before the app resolves it, want 0", s.PlayerRef())
	}
	s.SetPlayerRef(42)
	if s.PlayerRef() != 42 {
		t.Errorf("PlayerRef = %d after SetPlayerRef(42)", s.PlayerRef())
	}
}

func TestOpenSession_FlagsAMissingIdentity(t *testing.T) {
	s := openSeededSession(t, nil)
	if s.Player != (coach.Player{}) {
		t.Errorf("Player = %+v, want empty for a plain bundle", s.Player)
	}
	if s.HandleFromBundle {
		t.Error("HandleFromBundle = true for a bundle with no player block")
	}
}

// The identity a bundle suggests is read straight off a file the coach was
// handed, so a session must not open on one that no export could have
// written — it would key the coach's notes on an id their own notes file
// then refuses to carry.
func TestOpenSession_RejectsATamperedIdentity(t *testing.T) {
	payload := zipWithEntries(t, map[string][]byte{
		"manifest.json": []byte(`{"schema":"recall-bundle/v1","player":{"id":"sable-1","handle":"Sable"}}`),
		"data.json":     []byte(`{"schema":"recall-export/v1"}`),
	})
	if _, err := coach.OpenSession(payload, fixedNow); !errors.Is(err, bundle.ErrPlayerIdentityInvalid) {
		t.Fatalf("err = %v, want bundle.ErrPlayerIdentityInvalid", err)
	}
}

func TestOpenSession_RejectsANotesArchive(t *testing.T) {
	payload := zipWithEntries(t, map[string][]byte{"notes.json": []byte("{}"), "ledger.html": []byte("<p>")})
	_, err := coach.OpenSession(payload, fixedNow)
	if !errors.Is(err, coach.ErrNotABundle) {
		t.Fatalf("err = %v, want ErrNotABundle", err)
	}
}

func TestOpenSession_RejectsMalformedInput(t *testing.T) {
	for name, payload := range map[string][]byte{
		"not a zip":     []byte("hello"),
		"empty":         {},
		"zip, no files": zipWithEntries(t, map[string][]byte{"readme.txt": []byte("x")}),
	} {
		t.Run(name, func(t *testing.T) {
			_, err := coach.OpenSession(payload, fixedNow)
			if !errors.Is(err, bundle.ErrImportMalformed) {
				t.Fatalf("err = %v, want bundle.ErrImportMalformed", err)
			}
		})
	}
}

// The recipe pkg/app/aggregate.go runs against a store, run against the
// bundle's data.json instead: every layer attaches, inference runs, the
// records come out in match_key order, and nothing points at the coach's
// disk.
func TestBuildRecords_MatchesTheAggregateRecipe(t *testing.T) {
	contents, err := bundle.Read(exportBundle(t, seededStore(t), sharePlayer()))
	if err != nil {
		t.Fatalf("bundle.Read: %v", err)
	}
	recs := coach.BuildRecords(contents.Data)

	gotOrder := make([]string, 0, len(recs))
	for _, r := range recs {
		gotOrder = append(gotOrder, r.MatchKey)
	}
	if want := []string{keyManual, keyIlios, keyRank, keyUnknown}; !reflect.DeepEqual(gotOrder, want) {
		t.Fatalf("order = %v, want %v (ascending match_key, as GET /matches)", gotOrder, want)
	}
	byKey := map[string]match.Record{}
	for _, r := range recs {
		byKey[r.MatchKey] = r
	}
	assertIliosRecord(t, byKey[keyIlios])
	assertRankRecord(t, byKey[keyRank])
	assertManualRecord(t, byKey[keyManual])
	if !byKey[keyUnknown].Hidden {
		t.Error("hidden flag not attached")
	}
	for _, r := range recs {
		if r.ThumbnailFile != "" || len(r.SourceDirIDs) != 0 {
			t.Errorf("%s: thumbnail=%q dirIDs=%v — session records must never resolve against the coach's disk", r.MatchKey, r.ThumbnailFile, r.SourceDirIDs)
		}
	}
}

// assertIliosRecord pins every layer the aggregate recipe must have
// attached to the Ilios match, as a table of got/want values rather than a
// run of branches.
func assertIliosRecord(t *testing.T, r match.Record) {
	t.Helper()
	checks := []struct {
		what      string
		got, want any
	}{
		{"source", r.Source, match.SourceOCREdited},
		{"user-overlaid eliminations", r.Data.Eliminations, 30},
		{"annotation note", noteOf(r.Annotation), "threw"},
		{"annotation tags", tagsOf(r.Annotation), []string{"stack"}},
		{"reviewed by", r.ReviewedBy, "self"},
		{"reviewed at", r.ReviewedAt, "2026-08-02T00:00:00Z"},
		{"pinned", r.Pinned, true},
		{"coach layer", r.CoachNotes, []match.CoachNote{{
			ID: 1, NoteID: receivedNoteID, CoachName: "Prior", SessionDate: "2026-07-20",
			Text: "earlier coach", FocusTags: []string{"comms"}, ExtraTags: []string{}, AcceptedAt: "2026-07-21T00:00:00Z",
		}}},
		{"queue lifted from the parser row", r.QueueType, "role"},
		{"heroes played (InferSoleHeroPercent)", r.Data.HeroesPlayed, []parser.HeroPlay{
			{Hero: "ana", PercentPlayed: 100, Stats: map[string]int{"eliminations": 21}},
		}},
		{"map", r.Data.Map, "ilios"},
		{"game mode", r.Data.GameMode, "control"},
		{"role", r.Data.Role, "support"},
		{"source file count", len(r.SourceFiles), 2},
	}
	for _, c := range checks {
		if !reflect.DeepEqual(c.got, c.want) {
			t.Errorf("ilios %s = %+v, want %+v", c.what, c.got, c.want)
		}
	}
}

func noteOf(a *match.Annotation) string {
	if a == nil {
		return ""
	}
	return a.Note
}

func tagsOf(a *match.Annotation) []string {
	if a == nil {
		return nil
	}
	return a.Tags
}

func assertRankRecord(t *testing.T, r match.Record) {
	t.Helper()
	if r.Data.Result != "victory" {
		t.Errorf("InferResultFromRank did not run: result=%q", r.Data.Result)
	}
	if r.QueueType != "open" {
		t.Errorf("queue override not attached (manual wins): %q", r.QueueType)
	}
	if r.PlayMode != "competitive" {
		t.Errorf("play mode not attached: %q", r.PlayMode)
	}
	if r.Data.Rank != "diamond" || len(r.Data.SR) != 1 {
		t.Errorf("rank row not folded: %+v", r.Data)
	}
}

func assertManualRecord(t *testing.T, r match.Record) {
	t.Helper()
	if r.Source != match.SourceManual {
		t.Errorf("manual match not synthesized: source=%q", r.Source)
	}
	if r.Data.Map != "numbani" || r.Data.Hero != "lucio" || r.Data.Result != "defeat" {
		t.Errorf("manual data not overlaid: %+v", r.Data)
	}
	if r.SourceFiles == nil {
		t.Error("SourceFiles nil on a manual match — must marshal as []")
	}
}

func TestBuildRecords_EmptyDataYieldsEmptySlice(t *testing.T) {
	recs := coach.BuildRecords(bundle.DataV2{})
	if recs == nil || len(recs) != 0 {
		t.Errorf("BuildRecords(empty) = %v, want a non-nil empty slice", recs)
	}
}

func TestSession_MatchContextFor(t *testing.T) {
	s := openSeededSession(t, sharePlayer())
	got := s.MatchContextFor(keyIlios)
	want := &coach.MatchContext{Map: "ilios", Hero: "ana", Result: "victory", Date: "2026-08-01", FinishedAt: "18:30"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("MatchContextFor(ilios) = %+v, want %+v", got, want)
	}
	if s.MatchContextFor(keyNotInBundle) != nil {
		t.Error("MatchContextFor(unknown) != nil")
	}
	if ctx := s.MatchContextFor(keyManual); ctx == nil || ctx.Map != "numbani" {
		t.Errorf("MatchContextFor(manual) = %+v — the user layer feeds the snapshot too", ctx)
	}
}

// Records hands back the slice header only — the caller may filter or
// marshal it, and appending to it never grows the session's own corpus.
func TestSession_RecordsIsAViewOfTheCorpus(t *testing.T) {
	s := openSeededSession(t, sharePlayer())
	recs := s.Records()
	if len(recs) != 4 {
		t.Fatalf("Records() = %d, want 4", len(recs))
	}
	recs = append(recs, match.Record{MatchKey: keyNotInBundle})
	if s.MatchCount() != 4 || len(s.Records()) != 4 || s.HasMatch(recs[4].MatchKey) {
		t.Error("appending to the returned slice grew the session's corpus")
	}
}

// fieldsOf marshals a value and splits the top-level JSON object into its
// raw fields, so a wire-shape test can assert on names and values as data.
func fieldsOf(t *testing.T, v any) map[string]string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(b, &raw); err != nil {
		t.Fatalf("unmarshal %s: %v", b, err)
	}
	out := make(map[string]string, len(raw))
	for name, value := range raw {
		out[name] = string(value)
	}
	return out
}

func TestSession_View_WireShape(t *testing.T) {
	s := openSeededSession(t, sharePlayer())
	notes := []coach.Note{{NoteID: "n1", MatchKey: keyIlios, Kind: "note", Text: "hi", FocusTags: []string{"comms"}, ExtraTags: []string{}, MatchClock: "06:40", UpdatedAt: "2026-08-15T09:00:00Z"}}

	focus := []coach.FocusItem{{ItemID: focusIDOne, Text: "work on ults"}}

	got := fieldsOf(t, s.View(notes, focus, "Ordo", fixedNow))

	names := slices.Sorted(maps.Keys(got))
	wantNames := []string{"coach_name", "exported_at", "focus_items", "handle_from_bundle", "match_count", "notes", "player", "session_date", "source"}
	if !reflect.DeepEqual(names, wantNames) {
		t.Errorf("view fields = %v, want %v", names, wantNames)
	}
	// exported_at and player.id come from the bundle, so only the fields the
	// view itself decides are pinned to a value here.
	wantValues := map[string]string{
		"session_date":       `"2026-08-15"`,
		"match_count":        "4",
		"coach_name":         `"Ordo"`,
		"focus_items":        `[{"item_id":"` + focusIDOne + `","text":"work on ults"}]`,
		"handle_from_bundle": "true",
	}
	for name, want := range wantValues {
		if got[name] != want {
			t.Errorf("%s = %s, want %s", name, got[name], want)
		}
	}
	assertViewBlocks(t, got)
}

func assertViewBlocks(t *testing.T, got map[string]string) {
	t.Helper()
	contains := []struct{ field, want string }{
		{"player", `"handle":"Sable"`},
		{"player", `"message":`},
		{"notes", `"note_id":"n1"`},
	}
	for _, c := range contains {
		if !strings.Contains(got[c.field], c.want) {
			t.Errorf("%s = %s, want it to carry %s", c.field, got[c.field], c.want)
		}
	}
	if strings.Contains(got["notes"], `"match":`) {
		t.Errorf("notes = %s, want no match snapshot on the session view", got["notes"])
	}
}

func TestSession_View_NilNotesMarshalAsEmptyArray(t *testing.T) {
	s := openSeededSession(t, nil)
	b, err := json.Marshal(s.View(nil, nil, "", fixedNow))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `"notes":[]`) {
		t.Errorf("notes must marshal as [] not null: %s", b)
	}
	if !strings.Contains(string(b), `"handle_from_bundle":false`) {
		t.Errorf("handle_from_bundle missing: %s", b)
	}
}
