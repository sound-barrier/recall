package matchedit_test

import (
	"errors"
	"testing"

	"recall/pkg/db"
	"recall/pkg/match"
	"recall/pkg/matchedit"
)

// fullOverride exercises every shape the input carries: parent scalars plus
// all three child collections.
func fullOverride() match.UserMatchDataInput {
	return match.UserMatchDataInput{
		Map:          new("ilios"),
		Hero:         new("ana"),
		Eliminations: new(21),
		Heroes:       []match.UserHeroInput{{Hero: "kiriko", PercentPlayed: new(40), Position: 1}},
		HeroStats:    []match.UserHeroStatInput{{Hero: "ana", StatKey: "damage", Value: 4200}},
		SR:           []match.UserHeroSRInput{{Hero: "ana", SR: 2450, Change: -21}},
	}
}

func TestSetUserData_WritesTheParentScalars(t *testing.T) {
	fake := seeded("m1")
	mustNoErr(t, matchedit.SetUserData(fake, "m1", fullOverride()))

	got, ok := fake.UserMatchData["m1"]
	if !ok {
		t.Fatal("no override row written for m1")
	}
	if got.MatchKey != "m1" {
		t.Errorf("MatchKey = %q, want m1", got.MatchKey)
	}
	if got.Map == nil || *got.Map != "ilios" || got.Hero == nil || *got.Hero != "ana" {
		t.Errorf("map/hero = %v/%v, want ilios/ana", got.Map, got.Hero)
	}
	if got.Eliminations == nil || *got.Eliminations != 21 {
		t.Errorf("Eliminations = %v, want 21", got.Eliminations)
	}
}

// The three child collections are carried across independently — a heroes-list
// override must not imply a stat-cell one, and vice versa.
func TestSetUserData_WritesEveryChildCollection(t *testing.T) {
	fake := seeded("m1")
	mustNoErr(t, matchedit.SetUserData(fake, "m1", fullOverride()))

	got := fake.UserMatchData["m1"]
	if len(got.Heroes) != 1 || got.Heroes[0].Hero != "kiriko" || got.Heroes[0].Position != 1 {
		t.Errorf("Heroes = %+v, want one kiriko at position 1", got.Heroes)
	}
	if len(got.HeroStats) != 1 || got.HeroStats[0].Value != 4200 {
		t.Errorf("HeroStats = %+v, want one ana/damage/4200", got.HeroStats)
	}
	if len(got.SR) != 1 || got.SR[0].SR != 2450 || got.SR[0].Change != -21 {
		t.Errorf("SR = %+v, want ana 2450/-21", got.SR)
	}
}

// An override row on an unknown key does not annotate a match — it SYNTHESIZES
// one, so a client holding somebody else's keys could resurrect their match as
// a phantom in this history.
func TestSetUserData_RefusesAnUnknownKey(t *testing.T) {
	fake := seeded("m1")
	err := matchedit.SetUserData(fake, "stray", match.UserMatchDataInput{Map: new("ilios")})
	if !errors.Is(err, match.ErrMatchNotFound) {
		t.Fatalf("err = %v, want match.ErrMatchNotFound", err)
	}
	if len(fake.UserMatchData) != 0 {
		t.Errorf("refused write still left a row: %v", fake.UserMatchData)
	}
}

func TestSetUserData_RejectsInvalidResult(t *testing.T) {
	fake := seeded("m1")
	if err := matchedit.SetUserData(fake, "m1", match.UserMatchDataInput{Result: new("win")}); !errors.Is(err, matchedit.ErrInvalidResult) {
		t.Errorf("err = %v, want ErrInvalidResult", err)
	}
	// The three real outcomes are accepted; the empty string is not an
	// override, it is what "omit the field" would have sent.
	for _, ok := range []string{"victory", "defeat", "draw"} {
		mustNoErr(t, matchedit.SetUserData(fake, "m1", match.UserMatchDataInput{Result: &ok}))
	}
	if err := matchedit.SetUserData(fake, "m1", match.UserMatchDataInput{Result: new("")}); !errors.Is(err, matchedit.ErrInvalidResult) {
		t.Errorf("empty result: err = %v, want ErrInvalidResult", err)
	}
}

func TestUserDataWrites_RequireAMatchKey(t *testing.T) {
	fake := seeded("m1")
	if err := matchedit.SetUserData(fake, "", match.UserMatchDataInput{}); !errors.Is(err, matchedit.ErrMatchKeyRequired) {
		t.Errorf("SetUserData(\"\"): err = %v, want ErrMatchKeyRequired", err)
	}
	if err := matchedit.ResetUserData(fake, ""); !errors.Is(err, matchedit.ErrMatchKeyRequired) {
		t.Errorf("ResetUserData(\"\"): err = %v, want ErrMatchKeyRequired", err)
	}
}

func TestSetUserData_RejectsUnknownMap(t *testing.T) {
	fake := seeded("m1")
	if err := matchedit.SetUserData(fake, "m1", match.UserMatchDataInput{Map: new("notamap")}); !errors.Is(err, matchedit.ErrUnknownMap) {
		t.Errorf("err = %v, want ErrUnknownMap", err)
	}
	// An explicitly cleared map is not a roster claim — it means "drop the
	// override", which has to stay legal.
	mustNoErr(t, matchedit.SetUserData(fake, "m1", match.UserMatchDataInput{Map: new("")}))
}

// overriddenHeroes collects from four independent places, and a name that
// reaches the store unchecked poisons every hero-keyed chart. Each source is
// asserted on its own so a dropped arm names itself.
func TestSetUserData_RejectsAnUnknownHeroFromEverySource(t *testing.T) {
	const bad = "notahero"
	sources := map[string]match.UserMatchDataInput{
		"primary hero":  {Hero: new(bad)},
		"heroes played": {Heroes: []match.UserHeroInput{{Hero: "ana"}, {Hero: bad}}},
		"hero stats":    {HeroStats: []match.UserHeroStatInput{{Hero: bad, StatKey: "damage", Value: 10}}},
		"sr rows":       {SR: []match.UserHeroSRInput{{Hero: bad, SR: 2400}}},
	}
	for name, in := range sources {
		t.Run(name, func(t *testing.T) {
			fake := seeded("m1")
			if err := matchedit.SetUserData(fake, "m1", in); !errors.Is(err, matchedit.ErrUnknownHero) {
				t.Errorf("err = %v, want ErrUnknownHero", err)
			}
			if len(fake.UserMatchData) != 0 {
				t.Errorf("refused write still left a row: %v", fake.UserMatchData)
			}
		})
	}
}

// The same four sources carrying real heroes must all pass — a roster check
// that rejected everything would satisfy the test above by accident.
func TestSetUserData_AcceptsKnownHeroesFromEverySource(t *testing.T) {
	fake := seeded("m1")
	mustNoErr(t, matchedit.SetUserData(fake, "m1", match.UserMatchDataInput{
		Hero:      new("ana"),
		Heroes:    []match.UserHeroInput{{Hero: "kiriko"}},
		HeroStats: []match.UserHeroStatInput{{Hero: "lucio", StatKey: "healing", Value: 9000}},
		SR:        []match.UserHeroSRInput{{Hero: "mercy", SR: 2400}},
	}))
}

// An empty hero name is "not recorded", not a roster claim — the quick-add
// writes one, so rejecting it would break hero-less manual entries.
func TestSetUserData_AllowsEmptyHeroNames(t *testing.T) {
	fake := seeded("m1")
	mustNoErr(t, matchedit.SetUserData(fake, "m1", match.UserMatchDataInput{
		Hero:   new(""),
		Heroes: []match.UserHeroInput{{Hero: ""}},
	}))
}

func TestResetUserData_ClearsTheOverride(t *testing.T) {
	fake := seeded("m1")
	fake.UserMatchData = map[string]db.UserMatchData{"m1": {MatchKey: "m1", Damage: new(50)}}

	mustNoErr(t, matchedit.ResetUserData(fake, "m1"))
	if _, ok := fake.UserMatchData["m1"]; ok {
		t.Errorf("override still present after reset")
	}
	// Idempotent, and deliberately unguarded: clearing a key this database
	// never had removes nothing, which is what the UI's fire-and-forget
	// revert relies on.
	mustNoErr(t, matchedit.ResetUserData(fake, "m1"))
	mustNoErr(t, matchedit.ResetUserData(fake, "never-existed"))
}
