package bundle_test

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"recall/pkg/db"
	"recall/pkg/db/dbtest"
)

// The seeded corpus: three OCR match keys spread across all five parent tables
// (so an export/import walks every one of them) plus a manual match that exists
// ONLY in the user layer.
const (
	seededDirID   = int64(7)
	manualKey     = "manual-9"
	seededVersion = "0.26.0-test"
)

func seededKeys() []string { return []string{"m1", "m2", "m3", manualKey} }

// seededParentFiles are the screenshot basenames the seeded parent rows point
// at. unknown-3.png is deliberately absent from the on-disk set used by most
// tests so the missing-file prune has something to prune.
func seededParentFiles() []string {
	return []string{"summary-1.png", "teams-1.png", "personal-2.png", "rank-2.png"}
}

// seededStore returns a Fake carrying one row in every parent table (with its
// child rows attached) across three match keys, plus a complete user layer.
// shotsDir is registered as screenshots_dirs id 7 so the export's dir-id
// resolution has a non-sentinel path to resolve.
func seededStore(t *testing.T, shotsDir string) *dbtest.Fake {
	t.Helper()
	f := dbtest.New()
	f.DirIDs = map[string]int64{shotsDir: seededDirID}
	f.Summaries = []db.SummaryRow{{
		ID: 11, Filename: "summary-1.png", MatchKey: "m1", ScreenshotsDirID: seededDirID,
		Map: "ilios", Result: "victory", ParsedAt: "2026-05-01T00:00:00Z", PerfElimTotal: 21,
		HeroesPlayed: []db.SummaryHeroPlayed{{Hero: "ana", PercentPlayed: 80, PlayTime: "08:12"}},
	}}
	f.Teams = []db.TeamsRow{{
		ID: 12, Filename: "teams-1.png", MatchKey: "m1", ScreenshotsDirID: seededDirID,
		Eliminations: 21, Deaths: 4, QueueType: "role",
		HeroStats: []db.HeroStat{{Hero: "ana", StatKey: "eliminations", StatValue: 21}},
	}}
	f.Personals = []db.PersonalRow{{
		ID: 13, Filename: "personal-2.png", MatchKey: "m2", ScreenshotsDirID: seededDirID, Hero: "ana",
		HeroStats: []db.HeroStat{{Hero: "ana", StatKey: "nano_boost_assists", StatValue: 6}},
	}}
	f.Ranks = []db.RankRow{{
		ID: 14, Filename: "rank-2.png", MatchKey: "m2", ScreenshotsDirID: seededDirID,
		Rank: "diamond", Level: 3, Result: "victory",
		Modifiers: []string{"win streak"}, SR: []db.HeroSR{{Hero: "ana", SR: 3210, Change: 22}},
	}}
	f.Unknowns = []db.UnknownRow{{
		ID: 15, Filename: "unknown-3.png", MatchKey: "m3", ScreenshotsDirID: seededDirID,
	}}
	seedUserLayer(f)
	return f
}

// seedUserLayer attaches one of every user-layer surface, spread across the
// three OCR keys plus the manual-only key.
func seedUserLayer(f *dbtest.Fake) {
	f.UserMatchData = map[string]db.UserMatchData{
		"m1":      {MatchKey: "m1", Eliminations: new(30), UpdatedAt: "2026-05-02T00:00:00Z"},
		manualKey: {MatchKey: manualKey, Map: new("numbani"), Hero: new("lucio"), UpdatedAt: "2026-05-03T00:00:00Z"},
	}
	f.Annotations = map[string]db.Annotation{
		"m2": {MatchKey: "m2", Note: "threw", Tags: []string{"stack"}, AnnotatedAt: "2026-05-02T00:00:00Z"},
	}
	f.Reviews = map[string]db.ReviewState{"m1": {ReviewedBy: "coach", ReviewedAt: "2026-05-02T00:00:00Z"}}
	f.Queues = map[string]db.QueueState{"m2": {QueueType: "role", OverriddenAt: "2026-05-02T00:00:00Z"}}
	f.PlayModes = map[string]db.PlayModeState{"m3": {PlayMode: "competitive", OverriddenAt: "2026-05-02T00:00:00Z"}}
	f.Hidden = map[string]bool{"m3": true}
	// Two stars: m1 is inside the single-key export's include set (so the
	// restriction test can prove pins ship) and m2 is outside it (so the same
	// test can prove they don't leak).
	f.Pinned = map[string]bool{"m1": true, "m2": true}
}

// writeShots drops placeholder bytes at each named basename inside dir.
func writeShots(t *testing.T, dir string, names ...string) {
	t.Helper()
	for _, n := range names {
		if err := os.WriteFile(filepath.Join(dir, n), []byte("png-"+n), 0o600); err != nil {
			t.Fatalf("write %s: %v", n, err)
		}
	}
}

// removeShot deletes one screenshot from a fixture directory.
func removeShot(dir, name string) error { return os.Remove(filepath.Join(dir, name)) }

var errStoreDown = errors.New("store down")

// failingStore delegates every call to an in-memory Fake except the single
// named method, which fails. One failure at a time is what lets each store
// error the bundle paths must surface be pinned to its own wrapped message —
// the Fake's blanket UpsertErr can only ever reach the first table.
type failingStore struct {
	*dbtest.Fake
	fail string
}

var _ db.Store = (*failingStore)(nil)

func newFailingStore(method string) *failingStore {
	return &failingStore{Fake: dbtest.New(), fail: method}
}

func (s *failingStore) boom(method string) error {
	if s.fail == method {
		return errStoreDown
	}
	return nil
}

func (s *failingStore) LoadAll() (db.Screenshots, error) {
	if err := s.boom("LoadAll"); err != nil {
		return db.Screenshots{}, err
	}
	return s.Fake.LoadAll()
}

func (s *failingStore) LoadAllUserMatchData() (map[string]db.UserMatchData, error) {
	if err := s.boom("LoadAllUserMatchData"); err != nil {
		return nil, err
	}
	return s.Fake.LoadAllUserMatchData()
}

func (s *failingStore) LoadAnnotations() (map[string]db.Annotation, error) {
	if err := s.boom("LoadAnnotations"); err != nil {
		return nil, err
	}
	return s.Fake.LoadAnnotations()
}

func (s *failingStore) LoadReviews() (map[string]db.ReviewState, error) {
	if err := s.boom("LoadReviews"); err != nil {
		return nil, err
	}
	return s.Fake.LoadReviews()
}

func (s *failingStore) LoadMatchQueues() (map[string]db.QueueState, error) {
	if err := s.boom("LoadMatchQueues"); err != nil {
		return nil, err
	}
	return s.Fake.LoadMatchQueues()
}

func (s *failingStore) LoadMatchPlayModes() (map[string]db.PlayModeState, error) {
	if err := s.boom("LoadMatchPlayModes"); err != nil {
		return nil, err
	}
	return s.Fake.LoadMatchPlayModes()
}

func (s *failingStore) LoadHiddenKeys() (map[string]bool, error) {
	if err := s.boom("LoadHiddenKeys"); err != nil {
		return nil, err
	}
	return s.Fake.LoadHiddenKeys()
}

func (s *failingStore) LoadPinnedKeys() (map[string]bool, error) {
	if err := s.boom("LoadPinnedKeys"); err != nil {
		return nil, err
	}
	return s.Fake.LoadPinnedKeys()
}

func (s *failingStore) LoadMatchCoachNotes() (map[string][]db.MatchCoachNote, error) {
	if err := s.boom("LoadMatchCoachNotes"); err != nil {
		return nil, err
	}
	return s.Fake.LoadMatchCoachNotes()
}

func (s *failingStore) LoadMatchKeys() (map[string]bool, error) {
	if err := s.boom("LoadMatchKeys"); err != nil {
		return nil, err
	}
	return s.Fake.LoadMatchKeys()
}

func (s *failingStore) UpsertSummary(r db.SummaryRow) error {
	if err := s.boom("UpsertSummary"); err != nil {
		return err
	}
	return s.Fake.UpsertSummary(r)
}

func (s *failingStore) UpsertTeams(r db.TeamsRow) error {
	if err := s.boom("UpsertTeams"); err != nil {
		return err
	}
	return s.Fake.UpsertTeams(r)
}

func (s *failingStore) UpsertPersonal(r db.PersonalRow) error {
	if err := s.boom("UpsertPersonal"); err != nil {
		return err
	}
	return s.Fake.UpsertPersonal(r)
}

func (s *failingStore) UpsertRank(r db.RankRow) error {
	if err := s.boom("UpsertRank"); err != nil {
		return err
	}
	return s.Fake.UpsertRank(r)
}

func (s *failingStore) UpsertUnknown(r db.UnknownRow) error {
	if err := s.boom("UpsertUnknown"); err != nil {
		return err
	}
	return s.Fake.UpsertUnknown(r)
}

func (s *failingStore) UpsertUserMatchData(d db.UserMatchData) error {
	if err := s.boom("UpsertUserMatchData"); err != nil {
		return err
	}
	return s.Fake.UpsertUserMatchData(d)
}

func (s *failingStore) SetAnnotationAt(a db.Annotation) error {
	if err := s.boom("SetAnnotationAt"); err != nil {
		return err
	}
	return s.Fake.SetAnnotationAt(a)
}

func (s *failingStore) SetReviewAt(matchKey, reviewedBy, reviewedAt string) error {
	if err := s.boom("SetReviewAt"); err != nil {
		return err
	}
	return s.Fake.SetReviewAt(matchKey, reviewedBy, reviewedAt)
}

func (s *failingStore) SetMatchQueue(matchKey, queueType string) error {
	if err := s.boom("SetMatchQueue"); err != nil {
		return err
	}
	return s.Fake.SetMatchQueue(matchKey, queueType)
}

func (s *failingStore) SetMatchPlayMode(matchKey, playMode string) error {
	if err := s.boom("SetMatchPlayMode"); err != nil {
		return err
	}
	return s.Fake.SetMatchPlayMode(matchKey, playMode)
}

func (s *failingStore) HideMatch(matchKey string) error {
	if err := s.boom("HideMatch"); err != nil {
		return err
	}
	return s.Fake.HideMatch(matchKey)
}

func (s *failingStore) PinMatch(matchKey string) error {
	if err := s.boom("PinMatch"); err != nil {
		return err
	}
	return s.Fake.PinMatch(matchKey)
}

func (s *failingStore) UpsertMatchCoachNote(n db.MatchCoachNote) (int64, error) {
	if err := s.boom("UpsertMatchCoachNote"); err != nil {
		return 0, err
	}
	return s.Fake.UpsertMatchCoachNote(n)
}
