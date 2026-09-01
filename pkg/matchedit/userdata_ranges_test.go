package matchedit_test

import (
	"errors"
	"testing"

	"recall/pkg/match"
	"recall/pkg/matchedit"
)

// The numeric bounds api/openapi.yaml documents for the MatchResult response.
// The override layer echoes what it is given straight back, so a value outside
// these emits a record that violates the API's own schema — and every one of
// the twelve fields below carries its own bound, applied by its own line.
//
// Nine scalars sit on the parent row; three more live on the child
// collections, where the earlier coverage stopped entirely.

const (
	statLo, statHi     = 0, 1_000_000
	levelLo, levelHi   = 0, 5
	pctLo, pctHi       = 0, 100
	changeLo, changeHi = -1_000_000, 1_000_000
)

// scalarField names one *int override field and the bounds it must enforce.
type scalarField struct {
	name   string
	set    func(*match.UserMatchDataInput, *int)
	lo, hi int
}

func scalarFields() []scalarField {
	return []scalarField{
		{"eliminations", func(in *match.UserMatchDataInput, v *int) { in.Eliminations = v }, statLo, statHi},
		{"assists", func(in *match.UserMatchDataInput, v *int) { in.Assists = v }, statLo, statHi},
		{"deaths", func(in *match.UserMatchDataInput, v *int) { in.Deaths = v }, statLo, statHi},
		{"damage", func(in *match.UserMatchDataInput, v *int) { in.Damage = v }, statLo, statHi},
		{"healing", func(in *match.UserMatchDataInput, v *int) { in.Healing = v }, statLo, statHi},
		{"mitigation", func(in *match.UserMatchDataInput, v *int) { in.Mitigation = v }, statLo, statHi},
		{"level", func(in *match.UserMatchDataInput, v *int) { in.Level = v }, levelLo, levelHi},
		{"rank_progress", func(in *match.UserMatchDataInput, v *int) { in.RankProgress = v }, pctLo, pctHi},
		{"change_percent", func(in *match.UserMatchDataInput, v *int) { in.ChangePercent = v }, changeLo, changeHi},
	}
}

// Every scalar refuses a value one step outside its own bounds. Per-field
// rather than one blanket case, because the bounds differ per field: a level
// of 6 and a rank_progress of 6 are one legal and one not.
func TestSetUserData_EveryScalarRejectsOutOfRange(t *testing.T) {
	for _, f := range scalarFields() {
		t.Run(f.name, func(t *testing.T) {
			for _, bad := range []int{f.lo - 1, f.hi + 1} {
				var in match.UserMatchDataInput
				f.set(&in, &bad)
				fake := seeded("m1")
				if err := matchedit.SetUserData(fake, "m1", in); !errors.Is(err, matchedit.ErrStatOutOfRange) {
					t.Errorf("%s = %d: err = %v, want ErrStatOutOfRange", f.name, bad, err)
				}
				if len(fake.UserMatchData) != 0 {
					t.Errorf("%s = %d: refused write still left a row", f.name, bad)
				}
			}
		})
	}
}

// The bounds are INCLUSIVE, and a nil pointer means "not overridden" — a
// validator that rejected its own edges, or that treated nil as zero, would
// pass the rejection test above while breaking every legitimate edit.
func TestSetUserData_EveryScalarAcceptsItsEdgesAndNil(t *testing.T) {
	for _, f := range scalarFields() {
		t.Run(f.name, func(t *testing.T) {
			fake := seeded("m1")
			for _, ok := range []int{f.lo, f.hi} {
				var in match.UserMatchDataInput
				f.set(&in, &ok)
				if err := matchedit.SetUserData(fake, "m1", in); err != nil {
					t.Errorf("%s = %d rejected: %v", f.name, ok, err)
				}
			}
			var omitted match.UserMatchDataInput
			f.set(&omitted, nil)
			mustNoErr(t, matchedit.SetUserData(fake, "m1", omitted))
		})
	}
}

// The three child collections carry their own bounds, and the SR row carries
// two — an unchecked collection is the same schema violation as an unchecked
// scalar, just one nesting level down.
func TestSetUserData_EveryCollectionRejectsOutOfRange(t *testing.T) {
	cases := []struct {
		name string
		in   match.UserMatchDataInput
	}{
		{"hero percent_played above 100", userHeroPercent(pctHi + 1)},
		{"hero percent_played negative", userHeroPercent(pctLo - 1)},
		{"hero_stat value above the cap", userHeroStat(statHi + 1)},
		{"hero_stat value negative", userHeroStat(statLo - 1)},
		{"sr above the cap", userSR(statHi+1, 0)},
		{"sr negative", userSR(statLo-1, 0)},
		{"sr change above the cap", userSR(2400, changeHi+1)},
		{"sr change below the cap", userSR(2400, changeLo-1)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fake := seeded("m1")
			if err := matchedit.SetUserData(fake, "m1", tc.in); !errors.Is(err, matchedit.ErrStatOutOfRange) {
				t.Errorf("err = %v, want ErrStatOutOfRange", err)
			}
			if len(fake.UserMatchData) != 0 {
				t.Errorf("refused write still left a row")
			}
		})
	}
}

// The collection edges are inclusive too, including a nil percent_played
// (a heroes-list override that only reorders carries no percentage).
func TestSetUserData_EveryCollectionAcceptsItsEdges(t *testing.T) {
	accepted := []struct {
		name string
		in   match.UserMatchDataInput
	}{
		{"hero percent_played at 0", userHeroPercent(pctLo)},
		{"hero percent_played at 100", userHeroPercent(pctHi)},
		{"hero percent_played omitted", match.UserMatchDataInput{Heroes: []match.UserHeroInput{{Hero: "ana"}}}},
		{"hero_stat value at 0", userHeroStat(statLo)},
		{"hero_stat value at the cap", userHeroStat(statHi)},
		{"sr at the edges", userSR(statHi, changeHi)},
		{"sr at the low edges", userSR(statLo, changeLo)},
	}
	for _, tc := range accepted {
		t.Run(tc.name, func(t *testing.T) {
			mustNoErr(t, matchedit.SetUserData(seeded("m1"), "m1", tc.in))
		})
	}
}

func userHeroPercent(pct int) match.UserMatchDataInput {
	return match.UserMatchDataInput{Heroes: []match.UserHeroInput{{Hero: "ana", PercentPlayed: &pct}}}
}

func userHeroStat(value int) match.UserMatchDataInput {
	return match.UserMatchDataInput{
		HeroStats: []match.UserHeroStatInput{{Hero: "ana", StatKey: "damage", Value: value}},
	}
}

func userSR(sr, change int) match.UserMatchDataInput {
	return match.UserMatchDataInput{SR: []match.UserHeroSRInput{{Hero: "ana", SR: sr, Change: &change}}}
}

// A bad value anywhere in a collection is caught, not just in its first
// element — the loop has to keep going.
func TestSetUserData_ChecksEveryCollectionElement(t *testing.T) {
	bad := pctHi + 1
	in := match.UserMatchDataInput{Heroes: []match.UserHeroInput{
		{Hero: "ana", PercentPlayed: new(60)},
		{Hero: "kiriko", PercentPlayed: &bad},
	}}
	if err := matchedit.SetUserData(seeded("m1"), "m1", in); !errors.Is(err, matchedit.ErrStatOutOfRange) {
		t.Errorf("err = %v, want ErrStatOutOfRange from the second hero", err)
	}
}
