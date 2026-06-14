package fixtures

import (
	"math/rand"
)

func offRolePools(mainRole string) [][]string {
	out := make([][]string, 0, 2)
	if mainRole != "tank" {
		out = append(out, fixtureTanks)
	}
	if mainRole != "support" {
		out = append(out, fixtureSupports)
	}
	if mainRole != "dps" {
		out = append(out, fixtureDPS)
	}
	return out
}

// poolForRole returns the hero pool for a single role.
func poolForRole(role string) []string {
	switch role {
	case "tank":
		return fixtureTanks
	case "support":
		return fixtureSupports
	default:
		return fixtureDPS
	}
}

// otherRoles returns the two roles that aren't `mainRole`.
func otherRoles(mainRole string) []string {
	out := make([]string, 0, 2)
	for _, r := range []string{"tank", "support", "dps"} {
		if r != mainRole {
			out = append(out, r)
		}
	}
	return out
}

// pickRoleForMatch chooses the single role a role-queue match will be
// played in. Open-queue matches never call this — they don't have a
// per-match role constraint. Style + playMode weights mirror the
// hero-pool widening from the existing pickHero branches: in QP the
// player is more willing to queue for a role they don't main.
func (p playerProfile) pickRoleForMatch(rng *rand.Rand, playMode string) string {
	switch p.style {
	case styleOneTrick:
		// In QP, sometimes queue a different role to experiment with
		// other heroes; in comp, they're locked into their role.
		if playMode == "quickplay" && rng.Float64() < 0.20 {
			others := otherRoles(p.mainRole)
			return others[rng.Intn(len(others))]
		}
		return p.mainRole
	case styleOneRole:
		// One-role players define themselves by their role. In QP they
		// branch out more (40% off-role) than in comp (5% off-role).
		offProb := 0.05
		if playMode == "quickplay" {
			offProb = 0.40
		}
		if rng.Float64() < offProb {
			others := otherRoles(p.mainRole)
			return others[rng.Intn(len(others))]
		}
		return p.mainRole
	default: // styleFlex
		// Flex players switch roles freely. QP widens further toward
		// off-role queueing.
		mainProb := 0.60
		if playMode == "quickplay" {
			mainProb = 0.30
		}
		if rng.Float64() < mainProb {
			return p.mainRole
		}
		others := otherRoles(p.mainRole)
		return others[rng.Intn(len(others))]
	}
}

// pickHeroConstrained picks a hero from a single role's pool, applying
// the same style + playMode awareness as the unconstrained pickHero —
// just restricted to one role. Called by pickMatchHeroes when the
// match is role queue (locked role for the entire match).
func (p playerProfile) pickHeroConstrained(rng *rand.Rand, prevHero, playMode, role string) (string, string) {
	pool := poolForRole(role)

	// "Favorites" are the player's preferred heroes within this role,
	// derived from their style. For non-main roles the player has no
	// favorites — pickHeroConstrained falls through to pool-uniform.
	var favorites []string
	switch p.style {
	case styleOneTrick:
		if role == p.mainRole {
			favorites = []string{p.favoriteHero}
		}
	case styleOneRole:
		if role == p.mainRole {
			favorites = p.mainPool
		}
	case styleFlex:
		for _, h := range p.flexHeroes {
			if roleOfHero(h) == role {
				favorites = append(favorites, h)
			}
		}
	}

	// Off-mains in role = pool minus favorites.
	favSet := make(map[string]bool, len(favorites))
	for _, h := range favorites {
		favSet[h] = true
	}
	offMainsInRole := make([]string, 0, len(pool))
	for _, h := range pool {
		if !favSet[h] {
			offMainsInRole = append(offMainsInRole, h)
		}
	}

	// Streak: only fires when prev is in this role.
	if prevHero != "" && roleOfHero(prevHero) == role {
		streakProb := 0.25
		if playMode == "quickplay" {
			streakProb = 0.10
		}
		if rng.Float64() < streakProb {
			return role, prevHero
		}
	}

	// Favorite probability — style + playMode aware.
	favProb := constrainedFavoriteProb(p.style, playMode, role == p.mainRole)
	if len(favorites) > 0 && rng.Float64() < favProb {
		return role, favorites[rng.Intn(len(favorites))]
	}
	if len(offMainsInRole) > 0 {
		return role, offMainsInRole[rng.Intn(len(offMainsInRole))]
	}
	// Last-resort fall-through (should be unreachable — pool is never empty).
	return role, pool[rng.Intn(len(pool))]
}

// constrainedFavoriteProb returns the probability of picking a
// "favorite" hero (style-specific main) versus an off-main within
// the constrained role.
func constrainedFavoriteProb(style playStyle, playMode string, isMainRole bool) float64 {
	switch style {
	case styleOneTrick:
		if !isMainRole {
			return 0.0 // no favorite in off-roles — fall through to pool
		}
		if playMode == "quickplay" {
			return 0.40
		}
		return 0.95
	case styleOneRole:
		if !isMainRole {
			return 0.0
		}
		// One-role players in their role: mainPool === favorites, so
		// 100% from favorites both in QP and comp (off-mains-in-role
		// will be empty, making this a no-op anyway).
		return 1.0
	default: // flex
		if playMode == "quickplay" {
			return 0.30
		}
		return 0.80
	}
}
