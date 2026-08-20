package db_test

import (
	"strings"
	"testing"

	"recall/pkg/db"
)

// The override layer's core invariant is NULL = "not overridden, use OCR".
// Everything below pins a consequence of it, or of the single transaction
// that has to keep the parent row and its children in step.

// countRows reads a child-table row count straight off the store's handle —
// child rows are only reachable through their parent on the public surface,
// so cascade cleanup can't be observed any other way.
func countRows(t *testing.T, s *db.SQLStore, table string) int {
	t.Helper()
	var n int
	// #nosec G202 -- table is a literal from this test file.
	if err := db.RawDB(s).QueryRow(`SELECT count(*) FROM ` + table).Scan(&n); err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	return n
}

// seedBaselineOverride writes a known-good override the rejection cases below
// then try (and must fail) to overwrite.
func seedBaselineOverride(t *testing.T, s *db.SQLStore, key string) {
	t.Helper()
	mustNoErr(t, s.UpsertUserMatchData(db.UserMatchData{
		MatchKey: key, Map: new("hollywood"), Result: new("victory"),
		Modifiers: []string{"win streak"},
	}))
}

// assertBaselineIntact re-reads the override and fails if the rejected write
// left any of its own values behind.
func assertBaselineIntact(t *testing.T, s *db.SQLStore, key string) {
	t.Helper()
	all, err := s.LoadAllUserMatchData()
	mustNoErr(t, err)
	got, ok := all[key]
	if !ok {
		t.Fatalf("the rejected upsert deleted the existing override for %s", key)
	}
	if got.Map == nil || *got.Map != "hollywood" || got.Result == nil || *got.Result != "victory" {
		t.Errorf("scalars = (map %v, result %v), want the pre-rejection values", got.Map, got.Result)
	}
	if len(got.Modifiers) != 1 || got.Modifiers[0] != "win streak" {
		t.Errorf("modifiers = %v, want the pre-rejection [win streak]", got.Modifiers)
	}
}

// A value outside the schema's vocabulary must be rejected AND take the whole
// upsert with it. The child case is the one with teeth: the parent UPSERT has
// already run inside the transaction by the time the modifier CHECK fires, so
// without the rollback the user's map/result edits would be half-applied
// against a save the API reported as failed.
func TestSQLStore_UserMatchData_OutOfVocabularyValueRollsBackTheWholeUpsert(t *testing.T) {
	const key = "match-20260101120000"
	cases := []struct {
		name    string
		attempt db.UserMatchData
	}{
		{"parent result CHECK", db.UserMatchData{
			MatchKey: key, Map: new("busan"), Result: new("tie"),
		}},
		{"child modifier CHECK", db.UserMatchData{
			MatchKey: key, Map: new("busan"), Result: new("defeat"),
			Modifiers: []string{"overcharge"},
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s := openMemory(t)
			seedBaselineOverride(t, s, key)

			err := s.UpsertUserMatchData(c.attempt)
			if err == nil {
				t.Fatal("out-of-vocabulary value was accepted, want a CHECK violation")
			}
			if !strings.Contains(strings.ToLower(err.Error()), "constraint") {
				t.Errorf("error = %q, want it to name the constraint", err)
			}
			assertBaselineIntact(t, s, key)
		})
	}
}

// Heroes carry an explicit position (0 = primary) and the aggregator reads the
// list in order. Insertion order is whatever the client sent, so the load has
// to impose the ordering — here the rows go in back-to-front.
func TestSQLStore_UserMatchData_HeroesLoadBackInPositionOrder(t *testing.T) {
	s := openMemory(t)
	const key = "match-20260101120000"
	mustNoErr(t, s.UpsertUserMatchData(db.UserMatchData{
		MatchKey: key,
		Heroes: []db.UserMatchHero{
			{Hero: "junkrat", Position: 2},
			{Hero: "baptiste", Position: 0},
			{Hero: "juno", Position: 1},
		},
	}))
	all, err := s.LoadAllUserMatchData()
	mustNoErr(t, err)
	got := all[key].Heroes
	want := []string{"baptiste", "juno", "junkrat"}
	if len(got) != len(want) {
		t.Fatalf("heroes = %+v, want %d entries", got, len(want))
	}
	for i, hero := range want {
		if got[i].Hero != hero {
			t.Errorf("heroes[%d] = %q, want %q (position order, not insertion order)", i, got[i].Hero, hero)
		}
	}
}

// Blank child keys are dropped rather than stored: the manual-match form can
// submit an empty hero row, and an empty hero name is a legal primary-key
// component — it would surface as a nameless hero chip on the match card
// instead of failing loudly. Real siblings in the same payload still land.
func TestSQLStore_UserMatchData_DropsBlankChildKeys(t *testing.T) {
	s := openMemory(t)
	const key = "match-20260101120000"
	mustNoErr(t, s.UpsertUserMatchData(db.UserMatchData{
		MatchKey: key,
		Heroes:   []db.UserMatchHero{{Hero: ""}, {Hero: "juno"}},
		HeroStats: []db.UserMatchHeroStat{
			{Hero: "", StatKey: "healing", Value: 1},
			{Hero: "juno", StatKey: "", Value: 2},
			{Hero: "juno", StatKey: "healing", Value: 3},
		},
		SR: []db.HeroSR{{Hero: ""}, {Hero: "juno", SR: 2500}},
		// A blank modifier is not merely junk: it is outside the CHECK
		// vocabulary, so storing it would fail the entire save.
		Modifiers: []string{"", "win streak"},
	}))
	all, err := s.LoadAllUserMatchData()
	mustNoErr(t, err)
	got := all[key]
	if len(got.Heroes) != 1 || got.Heroes[0].Hero != "juno" {
		t.Errorf("heroes = %+v, want only juno", got.Heroes)
	}
	if len(got.HeroStats) != 1 || got.HeroStats[0].Value != 3 {
		t.Errorf("hero stats = %+v, want only the juno/healing cell", got.HeroStats)
	}
	if len(got.SR) != 1 || got.SR[0].Hero != "juno" {
		t.Errorf("sr = %+v, want only juno", got.SR)
	}
	if len(got.Modifiers) != 1 || got.Modifiers[0] != "win streak" {
		t.Errorf("modifiers = %v, want only [win streak]", got.Modifiers)
	}
}

// DeleteUserMatchData is the "reset to OCR" path. The children hang off the
// match_key FK with ON DELETE CASCADE, which SQLite only enforces when
// foreign_keys is ON for the connection — without it the parent vanishes while
// four child tables keep the user's heroes, stat cells, SR, and modifiers
// forever, invisible to every read path.
func TestSQLStore_DeleteUserMatchData_CascadesEveryChildTable(t *testing.T) {
	s := openMemory(t)
	const key = "match-20260101120000"
	mustNoErr(t, s.UpsertUserMatchData(db.UserMatchData{
		MatchKey:  key,
		Heroes:    []db.UserMatchHero{{Hero: "juno", Position: 0}},
		HeroStats: []db.UserMatchHeroStat{{Hero: "juno", StatKey: "healing", Value: 9000}},
		SR:        []db.HeroSR{{Hero: "juno", SR: 2500, Change: 21}},
		Modifiers: []string{"demotion protection"},
	}))

	mustNoErr(t, s.DeleteUserMatchData(key))

	for _, table := range []string{
		"user_match_heroes", "user_match_hero_stats",
		"user_match_sr", "user_match_rank_modifiers",
	} {
		if n := countRows(t, s, table); n != 0 {
			t.Errorf("%s kept %d orphan row(s) after the parent was deleted", table, n)
		}
	}
}

// position is an ORDER, not a number the row happens to carry: 0 is the
// primary hero, and the reader sorts on position alone. Two heroes at one
// slot would let SQLite's tiebreak name the primary hero — alphabetically,
// deterministically, and stably enough to read as data rather than damage.
//
// matchedit refuses this before it reaches the store, with an error the caller
// can read. The UNIQUE is the backstop under that, for every writer that is
// not the edit path — a bundle import, a future caller, a hand-rolled client.
func TestSQLStore_UserMatchHeroes_RefusesTwoHeroesInOneSlot(t *testing.T) {
	s := openMemory(t)
	err := s.UpsertUserMatchData(db.UserMatchData{
		MatchKey: "match-20260101120000",
		Heroes: []db.UserMatchHero{
			{Hero: "ana", Position: 0},
			{Hero: "reinhardt", Position: 0},
		},
	})
	if err == nil {
		t.Fatal("two heroes at position 0 were accepted; the roster has no primary hero it can name")
	}
	if !strings.Contains(err.Error(), "UNIQUE") {
		t.Errorf("err = %v, want the (match_key, position) UNIQUE to be what refused it", err)
	}
}

// The same hero arriving twice is still deduped rather than refused — that is
// the composite PK doing its job, and the targeted ON CONFLICT above must not
// have turned it into an error.
func TestSQLStore_UserMatchHeroes_StillDedupesARepeatedHero(t *testing.T) {
	s := openMemory(t)
	const key = "match-20260101120000"
	mustNoErr(t, s.UpsertUserMatchData(db.UserMatchData{
		MatchKey: key,
		Heroes: []db.UserMatchHero{
			{Hero: "ana", Position: 0},
			{Hero: "ana", Position: 0},
		},
	}))
	if n := countRows(t, s, "user_match_heroes"); n != 1 {
		t.Errorf("user_match_heroes = %d rows, want 1", n)
	}
}
