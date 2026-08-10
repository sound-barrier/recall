package fixtures_test

import (
	"math/rand"
	"slices"
	"testing"

	"recall/pkg/fixtures"
)

// TestConstrainedFavorites_PerStyle pins the role-locked favorites
// derivation behind role-queue hero picks: one-tricks favor their single
// hero only in their main role, one-role players favor their whole main
// pool, flex players favor their in-role mains — and nobody has favorites
// off-role (the constrained pick falls through to pool-uniform there).
func TestConstrainedFavorites_PerStyle(t *testing.T) {
	rng := rand.New(rand.NewSource(1))

	oneTrick := fixtures.NewProfileForStyle(rng, fixtures.ParsePlayStyle(rng, "one-trick"))
	if got, want := oneTrick.ConstrainedFavorites(oneTrick.MainRole()), []string{oneTrick.FavoriteHero()}; !slices.Equal(got, want) {
		t.Errorf("one-trick main-role favorites = %v, want %v", got, want)
	}
	if got := oneTrick.ConstrainedFavorites("tank"); len(got) != 0 {
		t.Errorf("one-trick off-role favorites = %v, want none", got)
	}

	oneRole := fixtures.NewProfileForStyle(rng, fixtures.ParsePlayStyle(rng, "one-role"))
	if got, want := oneRole.ConstrainedFavorites(oneRole.MainRole()), oneRole.MainPool(); !slices.Equal(got, want) {
		t.Errorf("one-role main-role favorites = %v, want the main pool %v", got, want)
	}
	if got := oneRole.ConstrainedFavorites("support"); len(got) != 0 {
		t.Errorf("one-role off-role favorites = %v, want none", got)
	}

	flex := fixtures.NewProfileForStyle(rng, fixtures.ParsePlayStyle(rng, "flex"))
	for _, role := range []string{"tank", "dps", "support"} {
		favorites := flex.ConstrainedFavorites(role)
		if len(favorites) == 0 {
			t.Errorf("flex favorites in %s empty, want the in-role mains", role)
		}
		for _, h := range favorites {
			if fixtures.RoleOfHero(h) != role {
				t.Errorf("flex favorite %q in %s plays another role", h, role)
			}
			if !slices.Contains(flex.FlexHeroes(), h) {
				t.Errorf("flex favorite %q in %s is not one of the player's mains", h, role)
			}
		}
	}
}
