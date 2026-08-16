package coach_test

import (
	"archive/zip"
	"bytes"
	"testing"
	"time"

	"recall/pkg/bundle"
	"recall/pkg/db"
	"recall/pkg/db/dbtest"
)

// The seeded corpus a coach opens: three OCR match keys spread across the
// five parent tables plus a manual match that exists only in the user
// layer. Keys are TRACKED (match-…) so notes can be written on them.
const (
	keyManual   = "match-2026-07-30T12-00-00"
	keyIlios    = "match-2026-08-01T18-30-00"
	keyRank     = "match-2026-08-02T20-05-00"
	keyUnknown  = "match-2026-08-03T21-00-00"
	seedVersion = "0.30.1-test"
	seedDirID   = int64(7)
)

// receivedNoteID is the coach-received block already on the player's
// Ilios match when the bundle is exported — the layer BuildRecords must
// carry through.
const receivedNoteID = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f"

func seededKeys() []string { return []string{keyManual, keyIlios, keyRank, keyUnknown} }

// seededStore returns a Fake carrying one row in every parent table across
// three match keys plus a complete user layer, in the shape pkg/bundle's
// own fixtures use.
func seededStore(t *testing.T) *dbtest.Fake {
	t.Helper()
	f := dbtest.New()
	f.DirIDs = map[string]int64{t.TempDir(): seedDirID}
	f.Summaries = []db.SummaryRow{{
		ID: 11, Filename: "2026-08-01_18-30-00-summary.png", MatchKey: keyIlios, ScreenshotsDirID: seedDirID,
		Map: "ilios", Hero: "ana", Result: "victory", Date: "2026-08-01", FinishedAt: "18:30",
		ParsedAt: "2026-08-01T18:31:00Z", PerfElimTotal: 21,
		HeroesPlayed: []db.SummaryHeroPlayed{{Hero: "ana"}},
	}}
	f.Teams = []db.TeamsRow{{
		ID: 12, Filename: "2026-08-01_18-29-00-teams.png", MatchKey: keyIlios, ScreenshotsDirID: seedDirID,
		Eliminations: 21, Deaths: 4, QueueType: "role",
		HeroStats: []db.HeroStat{{Hero: "ana", StatKey: "eliminations", StatValue: 21}},
	}}
	f.Personals = []db.PersonalRow{{
		ID: 13, Filename: "2026-08-02_20-04-00-personal.png", MatchKey: keyRank, ScreenshotsDirID: seedDirID, Hero: "ana",
		HeroStats: []db.HeroStat{{Hero: "ana", StatKey: "nano_boost_assists", StatValue: 6}},
	}}
	f.Ranks = []db.RankRow{{
		ID: 14, Filename: "2026-08-02_20-05-00-rank.png", MatchKey: keyRank, ScreenshotsDirID: seedDirID,
		Rank: "diamond", Level: 3,
		Modifiers: []string{"win streak"}, SR: []db.HeroSR{{Hero: "ana", SR: 3210, Change: 22}},
	}}
	f.Unknowns = []db.UnknownRow{{
		ID: 15, Filename: "2026-08-03_21-00-00-unknown.png", MatchKey: keyUnknown, ScreenshotsDirID: seedDirID,
	}}
	seedUserLayer(f)
	return f
}

// seedUserLayer attaches one of every user-layer surface, spread across the
// three OCR keys plus the manual-only key.
func seedUserLayer(f *dbtest.Fake) {
	f.UserMatchData = map[string]db.UserMatchData{
		keyIlios:  {MatchKey: keyIlios, Eliminations: new(30), UpdatedAt: "2026-08-02T00:00:00Z"},
		keyManual: {MatchKey: keyManual, Map: new("numbani"), Hero: new("lucio"), Result: new("defeat"), UpdatedAt: "2026-08-03T00:00:00Z"},
	}
	f.Annotations = map[string]db.Annotation{
		keyIlios: {MatchKey: keyIlios, Note: "threw", Tags: []string{"stack"}, AnnotatedAt: "2026-08-02T00:00:00Z"},
	}
	f.Reviews = map[string]db.ReviewState{keyIlios: {ReviewedBy: "self", ReviewedAt: "2026-08-02T00:00:00Z"}}
	f.Queues = map[string]db.QueueState{keyRank: {QueueType: "open", OverriddenAt: "2026-08-02T00:00:00Z"}}
	f.PlayModes = map[string]db.PlayModeState{keyRank: {PlayMode: "competitive", OverriddenAt: "2026-08-02T00:00:00Z"}}
	f.Hidden = map[string]bool{keyUnknown: true}
	f.Pinned = map[string]bool{keyIlios: true}
	f.MatchCoachNotes = []db.MatchCoachNote{{
		ID: 1, NoteID: receivedNoteID, MatchKey: keyIlios, CoachName: "Prior", SessionDate: "2026-07-20",
		Text: "earlier coach", FocusTags: []string{"comms"}, ExtraTags: []string{}, AcceptedAt: "2026-07-21T00:00:00Z",
	}}
}

// sharePlayer is a complete share-mode identity — the player "Sable".
func sharePlayer() *bundle.PlayerIdentity {
	return &bundle.PlayerIdentity{
		ID:      "9e7b2a10-5f4c-4d6e-8a21-3b0c7d9e4f52",
		Handle:  "Sable",
		Message: "Mostly worried about my ult timing on control.",
	}
}

// exportBundle builds the bundle a player would hand a coach: every seeded
// key, optionally in share mode.
func exportBundle(t *testing.T, store *dbtest.Fake, player *bundle.PlayerIdentity) []byte {
	t.Helper()
	opts := bundle.ExportBundleOptions{MatchKeys: seededKeys(), Player: player}
	payload, err := bundle.Export(store, opts, nil, t.TempDir(), seedVersion)
	if err != nil {
		t.Fatalf("bundle.Export: %v", err)
	}
	return payload
}

// zipWithEntries builds a ZIP carrying the named entries with the given
// bodies — enough to drive the entry-name sniff and the archive reader.
func zipWithEntries(t *testing.T, entries map[string][]byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, body := range entries {
		w, err := zw.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Deflate, Modified: time.Unix(0, 0)})
		if err != nil {
			t.Fatalf("zip create %q: %v", name, err)
		}
		if _, err := w.Write(body); err != nil {
			t.Fatalf("zip write %q: %v", name, err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}
	return buf.Bytes()
}

var fixedNow = time.Date(2026, 8, 15, 9, 12, 0, 0, time.UTC)
