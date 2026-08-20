package bundle_test

import (
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"recall/pkg/bundle"
	"recall/pkg/db"
	"recall/pkg/db/dbtest"
)

// sharePlayer is a complete, valid share-mode identity.
func sharePlayer() *bundle.PlayerIdentity {
	return &bundle.PlayerIdentity{
		ID:      "0f8fad5b-d9cb-469f-a165-70867728950e",
		Handle:  "Sable",
		Message: "Mostly Ana this week — losing the mid fights.",
	}
}

// shareManifest is okManifest plus a player block, i.e. the manifest a
// "share with a coach" export writes.
func shareManifest() map[string]any {
	mf := okManifest()
	mf["player"] = map[string]any{"id": sharePlayer().ID, "handle": "Sable"}
	return mf
}

// The identity rides in the MANIFEST and nowhere else: data.json is the
// row payload a merge import consumes and must stay byte-identical between a
// plain export and a share-mode one, so a coach's tooling reads the player
// off the envelope, never off the data.
func TestExport_ShareModeWritesPlayerToManifestOnly(t *testing.T) {
	shots := t.TempDir()
	store := seededStore(t, shots)
	opts := bundle.ExportBundleOptions{MatchKeys: seededKeys(), Player: sharePlayer()}

	payload, err := bundle.Export(store, opts, nil, shots, seededVersion)
	if err != nil {
		t.Fatalf("Export: %v", err)
	}
	mf := exportedManifest(t, payload)
	if mf.Player == nil || *mf.Player != *sharePlayer() {
		t.Fatalf("manifest.player = %+v, want %+v", mf.Player, sharePlayer())
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(readZip(t, payload)["data.json"], &raw); err != nil {
		t.Fatalf("decode data.json: %v", err)
	}
	if _, leaked := raw["player"]; leaked {
		t.Error("data.json carries the player identity; it belongs to the manifest only")
	}
}

// A plain export must not grow a "player" key at all — the field is
// omitempty precisely so an older build reading the manifest sees the same
// bytes it always did.
func TestExport_PlainExportOmitsPlayerKey(t *testing.T) {
	shots := t.TempDir()
	store := seededStore(t, shots)

	payload, err := bundle.Export(store, bundle.ExportBundleOptions{MatchKeys: seededKeys()}, nil, shots, seededVersion)
	if err != nil {
		t.Fatalf("Export: %v", err)
	}
	if strings.Contains(string(readZip(t, payload)["manifest.json"]), `"player"`) {
		t.Error("plain export wrote a player key into the manifest")
	}
	contents, err := bundle.Read(payload)
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if contents.Manifest.Player != nil {
		t.Errorf("Read of a plain bundle yields Player = %+v, want nil", contents.Manifest.Player)
	}
}

// The identity is validated at the export boundary so a bundle can never
// leave the machine with a blank handle or a garbage id: the coach side
// keys its notes on these, and a bad value would poison every later session.
func TestExport_RejectsInvalidPlayerIdentity(t *testing.T) {
	tests := []struct {
		name   string
		player bundle.PlayerIdentity
	}{
		{"blank handle", bundle.PlayerIdentity{Handle: ""}},
		{"whitespace-only handle", bundle.PlayerIdentity{Handle: "   \t"}},
		{"handle over 64 runes", bundle.PlayerIdentity{Handle: strings.Repeat("é", 65)}},
		{"message over 2000 runes", bundle.PlayerIdentity{Handle: "Sable", Message: strings.Repeat("ü", 2001)}},
		{"id that is not a UUID", bundle.PlayerIdentity{Handle: "Sable", ID: "sable-1"}},
		{"id with the wrong group lengths", bundle.PlayerIdentity{Handle: "Sable", ID: "0f8fad5bd9cb-469f-a165-70867728950e"}},
		{"id with a non-hex rune", bundle.PlayerIdentity{Handle: "Sable", ID: "0f8fad5b-d9cb-469f-a165-70867728950g"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			player := tc.player
			opts := bundle.ExportBundleOptions{MatchKeys: []string{"m1"}, Player: &player}
			payload, err := bundle.Export(dbtest.New(), opts, nil, t.TempDir(), seededVersion)
			if !errors.Is(err, bundle.ErrPlayerIdentityInvalid) {
				t.Fatalf("err = %v, want it to wrap ErrPlayerIdentityInvalid", err)
			}
			if payload != nil {
				t.Error("a rejected identity must not hand back a bundle")
			}
		})
	}
}

// The handle is trimmed on the way out and the boundaries are inclusive:
// exactly 64 handle runes and exactly 2000 message runes are legal, and an
// anonymous share (no id) is a valid identity.
func TestExport_AcceptsPlayerIdentityAtTheBoundaries(t *testing.T) {
	shots := t.TempDir()
	player := &bundle.PlayerIdentity{
		Handle:  "  " + strings.Repeat("é", 64) + "  ",
		Message: strings.Repeat("ü", 2000),
	}
	opts := bundle.ExportBundleOptions{MatchKeys: []string{"m1"}, Player: player}
	payload, err := bundle.Export(seededStore(t, shots), opts, nil, shots, seededVersion)
	if err != nil {
		t.Fatalf("Export: %v", err)
	}
	got := exportedManifest(t, payload).Player
	if got == nil || got.Handle != strings.Repeat("é", 64) || got.ID != "" {
		t.Errorf("manifest.player = %+v, want the trimmed 64-rune handle and no id", got)
	}
}

// A bundle from a build that predates the identity has no player key at all;
// it must read back with a nil Player, not an error and not a zero struct.
func TestRead_OldBundleYieldsNilPlayer(t *testing.T) {
	contents, err := bundle.Read(okPayload(t))
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if contents.Manifest.Player != nil {
		t.Errorf("Player = %+v, want nil for a bundle with no player block", contents.Manifest.Player)
	}
	if contents.Manifest.Schema != bundleSchemaV1 || len(contents.Data.Summaries) != 1 {
		t.Errorf("contents = %+v, want the manifest schema and the one summary row", contents)
	}
}

// Read hands back the identity a share-mode export wrote, and strips the
// BOM on the way in like Import does.
func TestRead_ShareBundleYieldsPlayer(t *testing.T) {
	payload := append([]byte("\xef\xbb\xbf"), buildZip(t,
		jsonFileEntry(t, "manifest.json", shareManifest()),
		jsonFileEntry(t, "data.json", okData()),
	)...)
	contents, err := bundle.Read(payload)
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	want := bundle.PlayerIdentity{ID: sharePlayer().ID, Handle: "Sable"}
	if contents.Manifest.Player == nil || *contents.Manifest.Player != want {
		t.Errorf("Player = %+v, want %+v", contents.Manifest.Player, want)
	}
}

// A manifest is JSON inside a file somebody handed the coach: hand-edited,
// corrupted or written by other tooling, its identity can say anything.
// Read holds it to the same rules Export does, so a junk id can never reach
// the coach's store — where it would key a player row whose notes the notes
// file would then refuse to carry, blocking that coach's export for good.
func TestRead_RefusesAnInvalidPlayerIdentity(t *testing.T) {
	tests := map[string]map[string]any{
		"id that is not a UUID":   {"id": "sable-1", "handle": "Sable"},
		"id with a non-hex rune":  {"id": "0f8fad5b-d9cb-469f-a165-70867728950g", "handle": "Sable"},
		"blank handle":            {"id": sharePlayer().ID, "handle": "   "},
		"handle over 64 runes":    {"handle": strings.Repeat("é", 65)},
		"message over 2000 runes": {"handle": "Sable", "message": strings.Repeat("ü", 2001)},
	}
	for name, player := range tests {
		t.Run(name, func(t *testing.T) {
			mf := okManifest()
			mf["player"] = player
			payload := buildZip(t,
				jsonFileEntry(t, "manifest.json", mf),
				jsonFileEntry(t, "data.json", okData()),
			)
			contents, err := bundle.Read(payload)
			if !errors.Is(err, bundle.ErrPlayerIdentityInvalid) {
				t.Fatalf("err = %v, want it to wrap ErrPlayerIdentityInvalid", err)
			}
			if contents.Manifest.Player != nil {
				t.Errorf("a refused bundle handed back an identity: %+v", contents.Manifest.Player)
			}
		})
	}
}

// The handle is a display label the coach's UI renders; padding it in the
// manifest must not survive the read.
func TestRead_TrimsThePlayerHandle(t *testing.T) {
	mf := okManifest()
	mf["player"] = map[string]any{"id": sharePlayer().ID, "handle": "  Sable\t"}
	payload := buildZip(t,
		jsonFileEntry(t, "manifest.json", mf),
		jsonFileEntry(t, "data.json", okData()),
	)
	contents, err := bundle.Read(payload)
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if contents.Manifest.Player == nil || contents.Manifest.Player.Handle != "Sable" {
		t.Errorf("player = %+v, want the trimmed handle", contents.Manifest.Player)
	}
}

// A coach who mis-clicks Import… on a bundle a player shared for review must
// not merge that player's matches into their own history. The refusal is a
// 409 (readable, refused) and it happens before the store is so much as read.
func TestImport_RefusesShareModeBundleAndLeavesStoreUntouched(t *testing.T) {
	store := seedLocalEdits(t)
	store.MatchCoachNotes = []db.MatchCoachNote{{ID: 1, NoteID: "n-1", MatchKey: "m1", CoachName: "Ordo", Text: "keep"}}
	before := storeSnapshot(t, store)
	payload := buildZip(t,
		jsonFileEntry(t, "manifest.json", shareManifest()),
		jsonFileEntry(t, "data.json", allTablesData()),
	)

	summary, err := bundle.Import(store, payload)
	if !errors.Is(err, bundle.ErrCoachBundle) {
		t.Fatalf("err = %v, want it to wrap ErrCoachBundle", err)
	}
	if errors.Is(err, bundle.ErrImportMalformed) {
		t.Error("a share-mode bundle is readable; refusing it is a 409, not a 400")
	}
	if summary != (bundle.ImportSummary{}) {
		t.Errorf("summary = %+v, want zero", summary)
	}
	if store.UpsertCalls != 0 {
		t.Errorf("%d rows written; a refused bundle must not touch the store", store.UpsertCalls)
	}
	if after := storeSnapshot(t, store); !reflect.DeepEqual(before, after) {
		t.Errorf("store changed across a refused import:\nbefore %+v\nafter  %+v", before, after)
	}
}

// storeSnapshot captures every surface a merge import can write, so a refused
// import can be proven inert by comparison rather than by counting one table.
type writableSurfaces struct {
	Rows       db.Screenshots
	UserData   map[string]db.UserMatchData
	Notes      map[string]db.Annotation
	CoachNotes map[string][]db.MatchCoachNote
	Hidden     map[string]bool
	Pinned     map[string]bool
}

func storeSnapshot(t *testing.T, store db.Store) writableSurfaces {
	t.Helper()
	rows, err := store.LoadAll()
	if err != nil {
		t.Fatalf("LoadAll: %v", err)
	}
	userData, err := store.LoadAllUserMatchData()
	if err != nil {
		t.Fatalf("LoadAllUserMatchData: %v", err)
	}
	notes, err := store.LoadAnnotations()
	if err != nil {
		t.Fatalf("LoadAnnotations: %v", err)
	}
	coachNotes, err := store.LoadMatchCoachNotes()
	if err != nil {
		t.Fatalf("LoadMatchCoachNotes: %v", err)
	}
	hidden, err := store.LoadHiddenKeys()
	if err != nil {
		t.Fatalf("LoadHiddenKeys: %v", err)
	}
	pinned, err := store.LoadPinnedKeys()
	if err != nil {
		t.Fatalf("LoadPinnedKeys: %v", err)
	}
	return writableSurfaces{rows, userData, notes, coachNotes, hidden, pinned}
}

// seedCoachNotes attaches accepted coach blocks to the seeded corpus: two on
// m1 (in reverse NoteID order, so the export's sort has something to do), one
// on m2, and one on a key outside every include set used below.
func seedCoachNotes(f *dbtest.Fake) {
	f.MatchCoachNotes = []db.MatchCoachNote{
		{ID: 1, NoteID: "n-b", MatchKey: "m1", CoachName: "Ordo", SessionDate: "2026-08-08", Text: "second on m1", FocusTags: []string{"positioning"}, AcceptedAt: "2026-08-09T00:00:00Z"},
		{ID: 2, NoteID: "n-a", MatchKey: "m1", CoachName: "Ordo", SessionDate: "2026-08-08", Text: "first on m1", MatchClock: "04:12", ExtraTags: []string{"nano timing"}, AcceptedAt: "2026-08-09T00:00:01Z"},
		{ID: 3, NoteID: "n-c", MatchKey: "m2", CoachName: "Ordo", SessionDate: "2026-08-08", Text: "on m2", AcceptedAt: "2026-08-09T00:00:02Z"},
		{ID: 4, NoteID: "n-d", MatchKey: "elsewhere", CoachName: "Ordo", SessionDate: "2026-08-08", Text: "not selected", AcceptedAt: "2026-08-09T00:00:03Z"},
	}
}

// The received coach layer is hand-curated state exactly like an annotation:
// it ships in the bundle, restricted to the include set, in a deterministic
// (match_key, note_id) order.
func TestExport_CoachNotesShipForIncludedKeysInStableOrder(t *testing.T) {
	shots := t.TempDir()
	store := seededStore(t, shots)
	seedCoachNotes(store)

	payload, err := bundle.Export(store, bundle.ExportBundleOptions{MatchKeys: []string{"m1", "m2"}}, nil, shots, seededVersion)
	if err != nil {
		t.Fatalf("Export: %v", err)
	}
	got := exportedData(t, payload).CoachNotes
	ids := make([]string, 0, len(got))
	for _, n := range got {
		ids = append(ids, n.MatchKey+"/"+n.NoteID)
	}
	want := []string{"m1/n-a", "m1/n-b", "m2/n-c"}
	if !reflect.DeepEqual(ids, want) {
		t.Errorf("coach_notes order = %v, want %v", ids, want)
	}
	if got[0].Text != "first on m1" || got[0].MatchClock != "04:12" || !reflect.DeepEqual(got[0].ExtraTags, []string{"nano timing"}) {
		t.Errorf("first note lost fields in transit: %+v", got[0])
	}
}

// Import writes the coach blocks for NEW keys and skips them for keys the
// database already tracks — the same skip-existing rule every other sidecar
// follows, so a merge can never graft a stranger's coaching onto a match the
// user already has.
func TestImport_RoundTripsCoachNotesForNewKeysOnly(t *testing.T) {
	shots := t.TempDir()
	src := seededStore(t, shots)
	seedCoachNotes(src)
	writeShots(t, shots, seededParentFiles()...)
	payload, err := bundle.Export(src, bundle.ExportBundleOptions{MatchKeys: seededKeys()}, nil, shots, seededVersion)
	if err != nil {
		t.Fatalf("Export: %v", err)
	}

	dst := dbtest.New()
	dst.Personals = []db.PersonalRow{{ID: 99, Filename: "local-2.png", MatchKey: "m2"}}
	if _, err := bundle.Import(dst, payload); err != nil {
		t.Fatalf("Import: %v", err)
	}
	got, err := dst.LoadMatchCoachNotes()
	if err != nil {
		t.Fatalf("LoadMatchCoachNotes: %v", err)
	}
	if _, grafted := got["m2"]; grafted {
		t.Errorf("coach note landed on the pre-existing key m2: %+v", got["m2"])
	}
	m1 := got["m1"]
	if len(m1) != 2 {
		t.Fatalf("m1 carries %d coach blocks, want 2: %+v", len(m1), m1)
	}
	assertCoachNoteRoundTripped(t, m1)
}

func assertCoachNoteRoundTripped(t *testing.T, notes []db.MatchCoachNote) {
	t.Helper()
	got := map[string]db.MatchCoachNote{}
	ids := map[int64]bool{}
	for _, n := range notes {
		ids[n.ID] = true
		// The exporting machine's row id and accept instant are the store's
		// to mint; everything else must come through untouched.
		n.ID, n.AcceptedAt = 0, ""
		got[n.NoteID] = n
	}
	want := map[string]db.MatchCoachNote{
		"n-a": {NoteID: "n-a", MatchKey: "m1", CoachName: "Ordo", SessionDate: "2026-08-08", Text: "first on m1", MatchClock: "04:12", ExtraTags: []string{"nano timing"}},
		"n-b": {NoteID: "n-b", MatchKey: "m1", CoachName: "Ordo", SessionDate: "2026-08-08", Text: "second on m1", FocusTags: []string{"positioning"}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("coach notes = %+v\nwant %+v", got, want)
	}
	if len(ids) != 2 || ids[0] {
		t.Errorf("imported ids = %v, want two fresh non-zero ids", ids)
	}
}

// A coach block without its note_id cannot be keyed and would be refused by
// the store mid-import; it is named up front, before anything is written.
func TestImport_RejectsCoachNoteWithoutNoteID(t *testing.T) {
	store := dbtest.New()
	payload := payloadWithData(t, map[string]any{
		"schema":      dataSchema,
		"summaries":   []map[string]any{{"Filename": "a.png", "MatchKey": "m1"}},
		"coach_notes": []map[string]any{{"NoteID": "ok", "MatchKey": "m1"}, {"NoteID": "", "MatchKey": "m1"}},
	})
	_, err := bundle.Import(store, payload)
	if want := "import: coach_notes[1] missing required note_id"; err == nil || err.Error() != want {
		t.Fatalf("err = %v, want %q", err, want)
	}
	if store.UpsertCalls != 0 || len(store.MatchCoachNotes) != 0 {
		t.Error("rows were written before the bad coach note was found; a rejected bundle must not half-import")
	}
}

// LooksLikeZIP is the cheap sniff a sibling package uses to tell a bundle
// from anything else before opening it; the four PKZip signatures are the
// contract.
func TestLooksLikeZIP(t *testing.T) {
	tests := []struct {
		name    string
		payload []byte
		want    bool
	}{
		{"local file header", []byte("PK\x03\x04rest"), true},
		{"empty archive", []byte("PK\x05\x06rest"), true},
		{"spanned archive", []byte("PK\x07\x08rest"), true},
		{"three bytes is too short", []byte("PK\x03"), false},
		{"text", []byte("plain text"), false},
		{"nil", nil, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := bundle.LooksLikeZIP(tc.payload); got != tc.want {
				t.Errorf("LooksLikeZIP = %t, want %t", got, tc.want)
			}
		})
	}
}
