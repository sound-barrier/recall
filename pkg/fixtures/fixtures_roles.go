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
		// Quickplay is the practice space — the player queues off-role
		// freely there. Competitive follows the DPS-main split.
		if playMode == "quickplay" {
			if rng.Float64() < 0.30 {
				return p.mainRole
			}
			others := otherRoles(p.mainRole)
			return others[rng.Intn(len(others))]
		}
		return pickCompRole(rng, p.mainRole)
	}
}

// pickCompRole is the competitive role split: 85% the main role, 10% the
// first off-role, 5% the second (with a DPS main that reads tank 10% /
// support 5% — otherRoles returns tank-before-support). One knob for both
// role-queue role picks and open-queue hero weighting.
func pickCompRole(rng *rand.Rand, mainRole string) string {
	others := otherRoles(mainRole)
	switch r := rng.Float64(); {
	case r < 0.85:
		return mainRole
	case r < 0.95:
		return others[0]
	default:
		return others[1]
	}
}

// pickHeroConstrained picks a hero from a single role's pool, applying
// the same style + playMode awareness as the unconstrained pickHero —
// just restricted to one role. Called by pickMatchHeroes when the
// match is role queue (locked role for the entire match).
func (p playerProfile) pickHeroConstrained(rng *rand.Rand, prevHero, playMode, role string) (string, string) {
	pool := poolForRole(role)
	favorites := p.constrainedFavorites(role)
	// Off-mains in role = pool minus favorites.
	offMains := heroesExcluding(pool, favorites)

	if constrainedStreakFires(rng, prevHero, playMode, role) {
		return role, prevHero
	}

	// Favorite probability — style + playMode aware.
	favProb := constrainedFavoriteProb(p.style, playMode, role == p.mainRole)
	if len(favorites) > 0 && rng.Float64() < favProb {
		return role, favorites[rng.Intn(len(favorites))]
	}
	if len(offMains) > 0 {
		return role, offMains[rng.Intn(len(offMains))]
	}
	// Last-resort fall-through (should be unreachable — pool is never empty).
	return role, pool[rng.Intn(len(pool))]
}

// constrainedFavorites is the player's preferred heroes within one role,
// derived from their style. For non-main roles the player has no favorites —
// pickHeroConstrained falls through to pool-uniform.
func (p playerProfile) constrainedFavorites(role string) []string {
	switch p.style {
	case styleOneTrick:
		if role == p.mainRole {
			return []string{p.favoriteHero}
		}
	case styleOneRole:
		if role == p.mainRole {
			return p.mainPool
		}
	case styleFlex:
		return p.favoritesInRole(role)
	}
	return nil
}

// constrainedStreakFires rolls the repeat-previous-hero streak: it only fires
// when prev is in this role, at 25% in competitive / 10% in quickplay.
func constrainedStreakFires(rng *rand.Rand, prevHero, playMode, role string) bool {
	if prevHero == "" || roleOfHero(prevHero) != role {
		return false
	}
	streakProb := 0.25
	if playMode == "quickplay" {
		streakProb = 0.10
	}
	return rng.Float64() < streakProb
}

// heroesExcluding returns pool minus the excluded heroes, preserving order.
func heroesExcluding(pool, excluded []string) []string {
	excludedSet := make(map[string]bool, len(excluded))
	for _, h := range excluded {
		excludedSet[h] = true
	}
	out := make([]string, 0, len(pool))
	for _, h := range pool {
		if !excludedSet[h] {
			out = append(out, h)
		}
	}
	return out
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
