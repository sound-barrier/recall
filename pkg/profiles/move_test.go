package profiles_test

import (
	"errors"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"recall/pkg/db"
	"recall/pkg/db/dbtest"
	"recall/pkg/profiles"
)

// Cross-profile move engine. Two real SQLite stores stand in for the two
// profiles' databases so the tests exercise the same UPSERT / CASCADE
// semantics production hits; the dbtest.Fake shows up only where a specific
// stage has to be made to fail.

const (
	movedKey  = "match-2026-05-10T22-00-00"
	stayedKey = "match-2026-05-10T23-00-00"
)

func mustNoErr(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

// newStore opens a real SQLStore in its own temp dir.
func newStore(t *testing.T, name string) *db.SQLStore {
	t.Helper()
	s, err := db.NewSQLStore(filepath.Join(t.TempDir(), name+".db"))
	if err != nil {
		t.Fatalf("open %q store: %v", name, err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

// seedFullMatch writes one match with a row in every table HardDeleteMatch
// wipes, so a move that forgets a table is observable as loss.
func seedFullMatch(t *testing.T, s db.Store, key string) {
	t.Helper()
	result := "defeat"
	mustNoErr(t, s.UpsertSummary(db.SummaryRow{
		Filename: key + "-summary.png", MatchKey: key, Map: "rialto", Hero: "lucio",
		Result:       "victory",
		HeroesPlayed: []db.SummaryHeroPlayed{{Hero: "lucio", PercentPlayed: 100}},
	}))
	mustNoErr(t, s.UpsertTeams(db.TeamsRow{
		Filename: key + "-teams.png", MatchKey: key, Eliminations: 17,
		HeroStats: []db.HeroStat{{Hero: "lucio", StatKey: "deaths", StatValue: 3}},
	}))
	mustNoErr(t, s.UpsertPersonal(db.PersonalRow{
		Filename: key + "-personal.png", MatchKey: key, Hero: "lucio",
		HeroStats: []db.HeroStat{{Hero: "lucio", StatKey: "healing", StatValue: 9001}},
	}))
	mustNoErr(t, s.UpsertRank(db.RankRow{
		Filename: key + "-rank.png", MatchKey: key, Rank: "platinum", Level: 3,
		RankProgress: 40, ChangePercent: -12, Result: "victory",
		Modifiers: []string{"expected"},
		SR:        []db.HeroSR{{Hero: "lucio", SR: 2450, Change: -21}},
	}))
	mustNoErr(t, s.UpsertUnknown(db.UnknownRow{Filename: key + "-unknown.png", MatchKey: key}))
	mustNoErr(t, s.SetAnnotation(db.Annotation{MatchKey: key, Note: "smurf lobby"}))
	mustNoErr(t, s.HideMatch(key))
	mustNoErr(t, s.PinMatch(key))
	mustNoErr(t, s.SetReview(key, "coach"))
	mustNoErr(t, s.SetMatchQueue(key, "role"))
	mustNoErr(t, s.SetMatchPlayMode(key, "competitive"))
	mustNoErr(t, s.UpsertUserMatchData(db.UserMatchData{MatchKey: key, Result: &result}))
	_, err := s.UpsertMatchCoachNote(db.MatchCoachNote{
		NoteID: "note-" + key, MatchKey: key, CoachName: "Ordo", SessionDate: "2026-08-08",
		Text: "hold high ground", FocusTags: []string{"positioning"},
	})
	mustNoErr(t, err)
}

// sidecarPresence reports, per sidecar table, whether the store still carries
// state for key. The keys name the tables HardDeleteMatch destroys on the
// source — every one of them has to be reproduced on the target.
func sidecarPresence(t *testing.T, s db.Store, key string) map[string]bool {
	t.Helper()
	annotations, err := s.LoadAnnotations()
	mustNoErr(t, err)
	hidden, err := s.LoadHiddenKeys()
	mustNoErr(t, err)
	pinned, err := s.LoadPinnedKeys()
	mustNoErr(t, err)
	reviews, err := s.LoadReviews()
	mustNoErr(t, err)
	userData, err := s.LoadAllUserMatchData()
	mustNoErr(t, err)
	queues, err := s.LoadMatchQueues()
	mustNoErr(t, err)
	playModes, err := s.LoadMatchPlayModes()
	mustNoErr(t, err)
	coachNotes, err := s.LoadMatchCoachNotes()
	mustNoErr(t, err)
	_, hasAnnotation := annotations[key]
	_, hasReview := reviews[key]
	_, hasUserData := userData[key]
	_, hasQueue := queues[key]
	_, hasPlayMode := playModes[key]
	_, hasCoachNote := coachNotes[key]
	return map[string]bool{
		"annotation": hasAnnotation,
		"hidden":     hidden[key],
		"pinned":     pinned[key],
		"review":     hasReview,
		"user_data":  hasUserData,
		"queue":      hasQueue,
		"play_mode":  hasPlayMode,
		"coach_note": hasCoachNote,
	}
}

// Phase 2 hard-deletes the source row, and HardDeleteMatch wipes EVERY sidecar
// table keyed on the match. Anything phase 1 forgets to copy is therefore
// destroyed outright rather than left behind — so the move's copy set and
// HardDeleteMatch's delete set have to stay in lockstep. (The pinned flag was
// exactly this bug: pinning shipped after the move engine and phase 1 was never
// extended, so moving a starred match silently unstarred it.)
func TestMove_ReproducesEverySidecarHardDeleteWipes(t *testing.T) {
	src, dst := newStore(t, "src"), newStore(t, "dst")
	seedFullMatch(t, src, movedKey)

	mustNoErr(t, profiles.Move(src, dst, []string{movedKey}))

	for name, present := range sidecarPresence(t, dst, movedKey) {
		if !present {
			t.Errorf("target is missing the %s sidecar — the move dropped it", name)
		}
	}
	for name, present := range sidecarPresence(t, src, movedKey) {
		if present {
			t.Errorf("source kept the %s sidecar — phase 2 left a stale row", name)
		}
	}
}

// All five parent tables move, children attached, filenames verbatim — a
// re-parse of the same PNG on the new profile then reads as already-ingested
// instead of creating a second copy. The rank row matters most: its SR children
// are the only record of the climb, and there is no way to re-derive them.
func TestMove_CarriesEveryParentTableWithItsChildren(t *testing.T) {
	src, dst := newStore(t, "src"), newStore(t, "dst")
	seedFullMatch(t, src, movedKey)
	seedFullMatch(t, src, stayedKey)

	mustNoErr(t, profiles.Move(src, dst, []string{movedKey}))

	target, err := dst.LoadAll()
	mustNoErr(t, err)
	summary := findSummary(t, target.Summaries, movedKey)
	if summary.Filename != movedKey+"-summary.png" {
		t.Errorf("filename rewritten on move: got %q", summary.Filename)
	}
	if len(summary.HeroesPlayed) != 1 || summary.HeroesPlayed[0].Hero != "lucio" {
		t.Errorf("summary child rows lost: %+v", summary.HeroesPlayed)
	}
	assertOneRowPerTable(t, target)
	if hasSummary(target.Summaries, stayedKey) {
		t.Error("target picked up a key that was not in the move set")
	}
	source, err := src.LoadAll()
	mustNoErr(t, err)
	if !hasSummary(source.Summaries, stayedKey) {
		t.Error("source lost a key that was not in the move set")
	}
}

func assertOneRowPerTable(t *testing.T, target db.Screenshots) {
	t.Helper()
	if len(target.Teams) != 1 || len(target.Teams[0].HeroStats) != 1 {
		t.Errorf("teams row/children lost: %+v", target.Teams)
	}
	if len(target.Personals) != 1 || len(target.Personals[0].HeroStats) != 1 {
		t.Errorf("personal row/children lost: %+v", target.Personals)
	}
	if len(target.Unknowns) != 1 {
		t.Errorf("unknown row lost: %+v", target.Unknowns)
	}
	assertRankRowIntact(t, target.Ranks)
}

func assertRankRowIntact(t *testing.T, ranks []db.RankRow) {
	t.Helper()
	if len(ranks) != 1 {
		t.Fatalf("rank row lost: %+v", ranks)
	}
	rank := ranks[0]
	if len(rank.SR) != 1 || rank.SR[0].SR != 2450 || rank.SR[0].Change != -21 {
		t.Errorf("rank SR children lost: %+v", rank.SR)
	}
	if len(rank.Modifiers) != 1 || rank.Modifiers[0] != "expected" {
		t.Errorf("rank modifier children lost: %+v", rank.Modifiers)
	}
}

// The documented crash-consistency contract: phase 1 writes the target, phase 2
// deletes the source. If phase 2 fails the match exists in BOTH profiles, and
// re-running the same keys must converge on one copy rather than duplicating
// the already-moved rows.
func TestMove_RetryAfterFailedDeleteConvergesWithoutDuplicates(t *testing.T) {
	src, dst := newStore(t, "src"), newStore(t, "dst")
	seedFullMatch(t, src, movedKey)

	boom := errors.New("disk gone")
	err := profiles.Move(deleteFailingStore{Store: src, err: boom}, dst, []string{movedKey})
	if !errors.Is(err, boom) {
		t.Fatalf("Move error = %v, want it to wrap the delete failure", err)
	}
	if !strings.Contains(err.Error(), "move: delete source row for "+strconv.Quote(movedKey)) {
		t.Errorf("phase-2 error does not name the stage and key: %v", err)
	}
	if !storeHasSummary(t, dst, movedKey) {
		t.Fatal("phase 1 did not commit — the canonical copy must already be on the target")
	}
	if !storeHasSummary(t, src, movedKey) {
		t.Fatal("source row vanished even though the delete failed")
	}

	// The retry re-targets the already-moved rows and completes the delete.
	mustNoErr(t, profiles.Move(src, dst, []string{movedKey}))

	target, err := dst.LoadAll()
	mustNoErr(t, err)
	if got := countSummaries(target.Summaries, movedKey); got != 1 {
		t.Errorf("target holds %d summary rows for the key after retry, want exactly 1", got)
	}
	if got := countTeams(target.Teams, movedKey); got != 1 {
		t.Errorf("target holds %d teams rows for the key after retry, want exactly 1", got)
	}
	if storeHasSummary(t, src, movedKey) {
		t.Error("retry did not finish the source delete")
	}
}

// screenshots_dirs ids are per-profile; only the path string is shared. Two
// source dirs must resolve to two distinct target ids — a resolver cache that
// collapsed them would silently re-point half the moved history at the wrong
// folder.
func TestMove_KeepsDistinctScreenshotsDirsDistinctOnTarget(t *testing.T) {
	src, dst := newStore(t, "src"), newStore(t, "dst")
	const dirA, dirB = "/shots/a", "/shots/b"
	// Offset the target's id space so a straight id copy can't accidentally pass.
	if _, err := dst.EnsureScreenshotsDir("/shots/unrelated"); err != nil {
		t.Fatalf("seed target dir: %v", err)
	}
	seedSummaryInDir(t, src, movedKey, dirA)
	seedSummaryInDir(t, src, stayedKey, dirB)

	mustNoErr(t, profiles.Move(src, dst, []string{movedKey, stayedKey}))

	target, err := dst.LoadAll()
	mustNoErr(t, err)
	movedID := findSummary(t, target.Summaries, movedKey).ScreenshotsDirID
	stayedID := findSummary(t, target.Summaries, stayedKey).ScreenshotsDirID
	if movedID == stayedID {
		t.Fatalf("both rows resolved to screenshots_dir id %d — the cache collapsed two dirs", movedID)
	}
	assertDirPath(t, dst, movedID, dirA)
	assertDirPath(t, dst, stayedID, dirB)
}

func assertDirPath(t *testing.T, s db.Store, id int64, want string) {
	t.Helper()
	got, err := s.LookupScreenshotsDir(id)
	mustNoErr(t, err)
	if got != want {
		t.Errorf("screenshots_dir id %d resolves to %q, want %q", id, got, want)
	}
}

func seedSummaryInDir(t *testing.T, s db.Store, key, dir string) {
	t.Helper()
	id, err := s.EnsureScreenshotsDir(dir)
	mustNoErr(t, err)
	mustNoErr(t, s.UpsertSummary(db.SummaryRow{
		Filename: key + "-summary.png", MatchKey: key, Map: "rialto",
		ScreenshotsDirID: id,
	}))
}

// deleteFailingStore delegates everything to the wrapped store except the
// phase-2 hard delete, which always fails — the "target written, source not yet
// cleaned" crash state the retry contract is written for.
type deleteFailingStore struct {
	db.Store
	err error
}

func (s deleteFailingStore) HardDeleteMatch(string) error { return s.err }

// ── Phase-1 failure injection ─────────────────────────────────────────────

// stageFailingStore fails exactly one Store method and delegates the rest to
// the embedded Fake, so each phase-1 stage can be failed in isolation.
type stageFailingStore struct {
	*dbtest.Fake
	failing string
	err     error
}

func (s *stageFailingStore) fails(stage string) error {
	if s.failing == stage {
		return s.err
	}
	return nil
}

func (s *stageFailingStore) LoadPinnedKeys() (map[string]bool, error) {
	if err := s.fails("pinned"); err != nil {
		return nil, err
	}
	return s.Fake.LoadPinnedKeys()
}

func (s *stageFailingStore) LoadAllUserMatchData() (map[string]db.UserMatchData, error) {
	if err := s.fails("user_data"); err != nil {
		return nil, err
	}
	return s.Fake.LoadAllUserMatchData()
}

func (s *stageFailingStore) HideMatch(key string) error {
	if err := s.fails("hide"); err != nil {
		return err
	}
	return s.Fake.HideMatch(key)
}

// A move that fails anywhere in phase 1 must leave the source untouched —
// phase 2 is the only thing allowed to delete, and it only runs after every
// target write succeeded. The wrapped message names the stage so a support log
// says which step gave up.
func TestMove_PhaseOneFailureLeavesSourceIntactAndNamesTheStage(t *testing.T) {
	boom := errors.New("injected failure")
	cases := []struct {
		name      string
		wantStage string
		arrange   func(src, dst *stageFailingStore)
	}{
		{"load source", "move: load source", func(src, _ *stageFailingStore) { src.LoadErr = boom }},
		{"load pinned keys", "move: load pinned keys", failStage("pinned", onSource)},
		{"load user data", "move: load user data", failStage("user_data", onSource)},
		{"upsert parent row", "move: upsert summary", func(_, dst *stageFailingStore) { dst.UpsertErr = boom }},
		{"copy hidden flag", "move: copy hidden flag", failStage("hide", onTarget)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			src, dst := newFailableStore(boom), newFailableStore(boom)
			seedFakeMatch(src)
			tc.arrange(src, dst)
			assertMoveAborted(t, src, dst, tc.wantStage, boom)
		})
	}
}

type failTarget bool

const (
	onSource failTarget = false
	onTarget failTarget = true
)

func failStage(stage string, where failTarget) func(src, dst *stageFailingStore) {
	return func(src, dst *stageFailingStore) {
		if where == onTarget {
			dst.failing = stage
			return
		}
		src.failing = stage
	}
}

func newFailableStore(err error) *stageFailingStore {
	return &stageFailingStore{Fake: dbtest.New(), err: err}
}

func seedFakeMatch(f *stageFailingStore) {
	f.Summaries = []db.SummaryRow{{Filename: movedKey + "-summary.png", MatchKey: movedKey, Map: "rialto"}}
	f.Hidden = map[string]bool{movedKey: true}
}

func assertMoveAborted(t *testing.T, src, dst *stageFailingStore, wantStage string, wrapped error) {
	t.Helper()
	err := profiles.Move(src, dst, []string{movedKey})
	if !errors.Is(err, wrapped) {
		t.Fatalf("Move error = %v, want it to wrap the injected failure", err)
	}
	if !strings.Contains(err.Error(), wantStage) {
		t.Errorf("Move error = %q, want it to name the %q stage", err, wantStage)
	}
	if len(src.HardDeleteCalls) != 0 {
		t.Errorf("phase 2 ran after a phase-1 failure: deleted %v", src.HardDeleteCalls)
	}
	if len(src.Summaries) != 1 {
		t.Errorf("source rows disappeared on a failed move: %+v", src.Summaries)
	}
}

// ── small readers ─────────────────────────────────────────────────────────

func findSummary(t *testing.T, rows []db.SummaryRow, key string) db.SummaryRow {
	t.Helper()
	for _, r := range rows {
		if r.MatchKey == key {
			return r
		}
	}
	t.Fatalf("no summary row for %q in %+v", key, rows)
	return db.SummaryRow{}
}

func hasSummary(rows []db.SummaryRow, key string) bool {
	return countSummaries(rows, key) > 0
}

func countSummaries(rows []db.SummaryRow, key string) int {
	n := 0
	for _, r := range rows {
		if r.MatchKey == key {
			n++
		}
	}
	return n
}

func countTeams(rows []db.TeamsRow, key string) int {
	n := 0
	for _, r := range rows {
		if r.MatchKey == key {
			n++
		}
	}
	return n
}

func storeHasSummary(t *testing.T, s db.Store, key string) bool {
	t.Helper()
	snap, err := s.LoadAll()
	mustNoErr(t, err)
	return hasSummary(snap.Summaries, key)
}

// Move's own doc comment states the invariant: "Phase 1's copy set MUST cover
// every table HardDeleteMatch wipes." Ambiguous candidates are such a table —
// forgetAmbiguitySurface deletes them by match_key AND by the parent rows'
// filename — so moving an unresolved ambiguous match destroyed its candidate
// list, landing a record on the target that the review card can never resolve.
func TestMove_CarriesTheAmbiguousCandidateList(t *testing.T) {
	src, target := &dbtest.Fake{}, &dbtest.Fake{}
	const ambig = "ambiguous-2026-01-01T12-00-00"
	const shot = "ambiguous-2026-01-01T12-00-00-summary.png"
	near, far := "match-2026-01-01T11-58-00", "match-2026-01-01T12-04-00"

	for _, k := range []string{ambig, near, far} {
		mustNoErr(t, src.UpsertSummary(db.SummaryRow{
			Filename: k + "-summary.png", MatchKey: k, Map: "rialto",
		}))
	}
	cands := []db.AmbiguousCandidate{
		{MatchKey: near, DistanceSeconds: 120},
		{MatchKey: far, DistanceSeconds: 240},
	}
	mustNoErr(t, src.ApplyAmbiguity(shot, cands))

	// Moved together with both candidate matches, the review list travels.
	mustNoErr(t, profiles.Move(src, target, []string{ambig, near, far}))

	got, err := target.LoadAmbiguousCandidatesFor(shot)
	mustNoErr(t, err)
	if len(got) != len(cands) {
		t.Fatalf("target has %d ambiguous candidates, want %d — the move dropped the review list", len(got), len(cands))
	}
	if got[0].MatchKey != near || got[1].MatchKey != far {
		t.Errorf("candidates = %+v, want %s then %s (nearest first)", got, near, far)
	}
}

// Moving an ambiguous match WITHOUT the matches it might belong to would land
// a review card whose every choice is absent — unresolvable, and phase 2 has
// already deleted the originals by then. Refuse before writing anything.
func TestMove_RefusesToStrandAnAmbiguousCandidate(t *testing.T) {
	src, target := &dbtest.Fake{}, &dbtest.Fake{}
	const ambig = "ambiguous-2026-01-01T12-00-00"
	const shot = "ambiguous-2026-01-01T12-00-00-summary.png"
	const near = "match-2026-01-01T11-58-00"

	for _, k := range []string{ambig, near} {
		mustNoErr(t, src.UpsertSummary(db.SummaryRow{
			Filename: k + "-summary.png", MatchKey: k, Map: "rialto",
		}))
	}
	mustNoErr(t, src.ApplyAmbiguity(shot, []db.AmbiguousCandidate{
		{MatchKey: near, DistanceSeconds: 120},
	}))

	err := profiles.Move(src, target, []string{ambig}) // near left behind
	if err == nil {
		t.Fatal("Move succeeded, want a refusal — the candidate would dangle on the target")
	}
	// Nothing may have been written or destroyed.
	if len(target.Summaries) != 0 {
		t.Errorf("target has %d rows after a refused move, want 0", len(target.Summaries))
	}
	if len(src.Summaries) != 2 {
		t.Errorf("source has %d rows after a refused move, want 2", len(src.Summaries))
	}
}
