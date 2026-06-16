package fixtures

import (
	"fmt"
	"math"
	"math/rand"
	"slices"
)

// playStyle is the seeded player's hero-pick shape. Picked once per
// GenerateMatchFixture call so a corpus reads as "this one player's
// season" rather than a uniform spray across every hero. Different
// seeds → different styles → different UI shapes (some "all juno",
// some "tank main with occasional flex", some "true flex").
type playStyle int

const (
	styleOneTrick playStyle = iota
	styleOneRole
	styleFlex
)

type playerProfile struct {
	style        playStyle
	mainRole     string
	mainPool     []string
	favoriteHero string   // for one-tricks
	flexHeroes   []string // for flex players: 2-3 mains per role
	offMains     []string // for flex players: heroes outside flexHeroes
}

// parsePlayStyle converts the seed-dev --style flag (and the
// equivalent Taskfile STYLE var) into a playStyle. Empty string and
// "flex" both produce the flex player — flex is the default because
// it's the only style whose corpus naturally covers every role +
// most heroes, which is what edge-case eyeballing wants. "random"
// preserves the original per-seed style picker so a multi-seed sweep
// can still hit one-trick and one-role corpuses.
func parsePlayStyle(rng *rand.Rand, s string) playStyle {
	switch s {
	case "", "flex":
		return styleFlex
	case "one-trick":
		return styleOneTrick
	case "one-role":
		return styleOneRole
	case "random":
		switch r := rng.Float64(); {
		case r < 0.2:
			return styleOneTrick
		case r < 0.5:
			return styleOneRole
		default:
			return styleFlex
		}
	default:
		return styleFlex
	}
}

func roleOfHero(hero string) string {
	if slices.Contains(fixtureTanks, hero) {
		return "tank"
	}
	if slices.Contains(fixtureSupports, hero) {
		return "support"
	}
	return "dps"
}

func newPlayerProfile(rng *rand.Rand, style playStyle) playerProfile {
	roles := []string{"tank", "support", "dps"}
	mainRole := roles[rng.Intn(len(roles))]
	var mainPool []string
	switch mainRole {
	case "tank":
		mainPool = fixtureTanks
	case "support":
		mainPool = fixtureSupports
	default:
		mainPool = fixtureDPS
	}

	p := playerProfile{style: style, mainRole: mainRole, mainPool: mainPool}
	switch style {
	case styleOneTrick:
		p.favoriteHero = mainPool[rng.Intn(len(mainPool))]
	case styleFlex:
		// 2-3 main heroes per role (6-9 total) — flex players carry
		// preferences within each role, not "anybody, anywhere."
		for _, pool := range [][]string{fixtureTanks, fixtureSupports, fixtureDPS} {
			perRole := 2 + rng.Intn(2) // 2 or 3
			perm := rng.Perm(len(pool))
			for i := 0; i < perRole && i < len(pool); i++ {
				p.flexHeroes = append(p.flexHeroes, pool[perm[i]])
			}
		}
		// off-mains = pool heroes the player didn't pick. Drives the
		// 10% experiment path so off-mains get the occasional touch
		// (and the per-seed-coverage pass has something realistic
		// to lean on when an off-main never came up naturally).
		for _, pool := range [][]string{fixtureTanks, fixtureSupports, fixtureDPS} {
			for _, h := range pool {
				if !containsHero(p.flexHeroes, h) {
					p.offMains = append(p.offMains, h)
				}
			}
		}
	case styleOneRole:
		// No extra state — the main-pool seam already drives picks.
	}
	return p
}

// pickHero returns the role + hero for the next match. prevHero (the
// hero from the previous match THIS DAY — reset across day boundaries)
// drives the streak probability so a session of repeated picks like
// lucio-lucio-reaper-lucio can form naturally.
//
// playMode shifts the per-style weights — in quickplay the player is
// far more willing to try heroes outside their usual pool. One-tricks
// branch out across all roles 70% of the time; one-role flexers leave
// their role 60% of the time; flex players lean into off-mains. In
// competitive the weights revert to the strict-pool defaults.
//
// roleConstraint, when non-empty, forces the pick into a single role —
// used for role-queue matches where the player picked their role at
// queue time and is locked there for the whole match. Open-queue
// matches pass "" and get the role-fluid pick logic below.
func (p playerProfile) pickHero(rng *rand.Rand, prevHero, playMode, roleConstraint string) (role, hero string) {
	if roleConstraint != "" {
		return p.pickHeroConstrained(rng, prevHero, playMode, roleConstraint)
	}
	switch p.style {
	case styleOneTrick:
		return p.pickHeroOneTrick(rng, playMode)
	case styleOneRole:
		return p.pickHeroOneRole(rng, prevHero, playMode)
	default: // styleFlex
		return p.pickHeroFlex(rng, prevHero, playMode)
	}
}

// pickHeroOneTrick: competitive locks the favorite (95%, 5% same-role
// experiment); quickplay loosens to 30% favorite / 70% any hero.
func (p playerProfile) pickHeroOneTrick(rng *rand.Rand, playMode string) (role, hero string) {
	if playMode == "quickplay" {
		// 30% favorite, 70% any hero from any role.
		if rng.Float64() < 0.30 {
			return p.mainRole, p.favoriteHero
		}
		allPools := [][]string{fixtureTanks, fixtureSupports, fixtureDPS}
		pool := allPools[rng.Intn(len(allPools))]
		h := pool[rng.Intn(len(pool))]
		return roleOfHero(h), h
	}
	if rng.Float64() < 0.95 {
		return p.mainRole, p.favoriteHero
	}
	// 5% experiment with another hero in their main role
	return p.mainRole, p.mainPool[rng.Intn(len(p.mainPool))]
}

// pickHeroOneRole: competitive stays in the main role (with a 40% in-role
// streak); quickplay is where this player branches off-role.
func (p playerProfile) pickHeroOneRole(rng *rand.Rand, prevHero, playMode string) (role, hero string) {
	if playMode == "quickplay" {
		// 40% main-role, 60% any off-role hero. No streak — QP
		// is where this player branches out.
		if rng.Float64() < 0.40 {
			return p.mainRole, p.mainPool[rng.Intn(len(p.mainPool))]
		}
		offPools := offRolePools(p.mainRole)
		off := offPools[rng.Intn(len(offPools))]
		h := off[rng.Intn(len(off))]
		return roleOfHero(h), h
	}
	// In-role streak: 40% chance of repeating the previous hero
	if prevHero != "" && roleOfHero(prevHero) == p.mainRole && rng.Float64() < 0.4 {
		return p.mainRole, prevHero
	}
	// 85% main role, 15% off-role experiment
	if rng.Float64() < 0.85 {
		return p.mainRole, p.mainPool[rng.Intn(len(p.mainPool))]
	}
	offPools := offRolePools(p.mainRole)
	off := offPools[rng.Intn(len(offPools))]
	h := off[rng.Intn(len(off))]
	return roleOfHero(h), h
}

// pickHeroFlex: competitive spreads across the flex pool (25% streak, 10%
// off-main); quickplay flips toward off-mains.
func (p playerProfile) pickHeroFlex(rng *rand.Rand, prevHero, playMode string) (role, hero string) {
	if playMode == "quickplay" {
		// 10% streak, 60% off-mains, 30% flex mains. Flips the
		// flex player's normal "stick to your pool" instinct.
		if prevHero != "" && rng.Float64() < 0.10 {
			return roleOfHero(prevHero), prevHero
		}
		if len(p.offMains) > 0 && rng.Float64() < 0.667 { // 0.60 / 0.90
			h := p.offMains[rng.Intn(len(p.offMains))]
			return roleOfHero(h), h
		}
		h := p.flexHeroes[rng.Intn(len(p.flexHeroes))]
		return roleOfHero(h), h
	}
	// 25% streak on previous hero
	if prevHero != "" && containsHero(p.flexHeroes, prevHero) && rng.Float64() < 0.25 {
		return roleOfHero(prevHero), prevHero
	}
	// 10% off-main experiment — keeps off-mains in the corpus
	// without the coverage pass having to do all the work.
	if len(p.offMains) > 0 && rng.Float64() < 0.10 {
		h := p.offMains[rng.Intn(len(p.offMains))]
		return roleOfHero(h), h
	}
	h := p.flexHeroes[rng.Intn(len(p.flexHeroes))]
	return roleOfHero(h), h
}

// heroPlay names one hero played in a single match, with the player's
// per-hero share. Multiple heroPlay per match models the typical
// "swapped once or twice" shape of real games — one-tricks excepted.
type heroPlay struct {
	Hero    string
	Role    string
	Percent int
}

// pickMatchHeroes picks the heroes the player touched in one match
// plus the percent_played share for each. Distribution by style:
//
//   - one-trick: always 1 hero (the favorite). One-trickers don't swap.
//   - flex / one-role / random: 10% 1 hero, 50% 2, 30% 3, 10% 4. Matches
//     real play — most games have a swap, occasionally two, rarely more.
//
// Heroes are drawn via the existing pickHero pump so the player's pool
// (mains + 10% off-main for flex) drives the picks. The first hero
// honors the cross-match streak; subsequent picks within the same
// match don't streak (the player wouldn't "swap back to the same
// hero" twice in a row).
//
// percent_played always sums to 100, allocated via exponential decay
// (factor 0.6) so the first hero gets the largest share and the
// long-tail picks drop off naturally.
func pickMatchHeroes(rng *rand.Rand, profile playerProfile, prevHero, playMode, queueType string) []heroPlay {
	count := 1
	if profile.style != styleOneTrick {
		switch r := rng.Float64(); {
		case r < 0.10:
			count = 1
		case r < 0.60:
			count = 2
		case r < 0.90:
			count = 3
		default:
			count = 4
		}
	}

	// Role-queue matches lock the player to a single role for the
	// whole match (5v5 role queue is the OW default since OW2). Open-
	// queue matches can mix roles freely. Pre-pick the role once per
	// match so every hero picked below honors the same constraint.
	var roleConstraint string
	if queueType == "role" {
		roleConstraint = profile.pickRoleForMatch(rng, playMode)
	}

	plays := make([]heroPlay, 0, count)
	seen := map[string]bool{}
	streak := prevHero
	attempts := 0
	for len(plays) < count && attempts < 50 {
		attempts++
		role, h := profile.pickHero(rng, streak, playMode, roleConstraint)
		if seen[h] {
			streak = "" // dupe — drop the streak bias and retry
			continue
		}
		seen[h] = true
		plays = append(plays, heroPlay{Hero: h, Role: role})
		streak = "" // streak only biases the first pick within a match
	}
	allocateHeroPercents(plays)
	return plays
}

// allocateHeroPercents fills plays[i].Percent with shares summing to
// 100, decaying exponentially from the first hero. Min 5% per hero so
// even the long-tail pick is visible in a dossier widget.
func allocateHeroPercents(plays []heroPlay) {
	n := len(plays)
	if n == 0 {
		return
	}
	weights := make([]float64, n)
	totalW := 0.0
	for i := range weights {
		weights[i] = math.Pow(0.6, float64(i))
		totalW += weights[i]
	}
	remaining := 100
	for i := range plays {
		if i == n-1 {
			plays[i].Percent = remaining
			return
		}
		p := max(int(weights[i]/totalW*100), 5)
		plays[i].Percent = p
		remaining -= p
	}
}

// formatPlayTime returns "M:SS" for a fraction of the total match
// seconds. Used for SummaryHeroPlayed.PlayTime so each hero's row
// looks like the parser output ("8:30") even when the match has 4
// heroes splitting the timeline.
func formatPlayTime(totalSec, percent int) string {
	s := totalSec * percent / 100
	return fmt.Sprintf("%d:%02d", s/60, s%60)
}

func containsHero(pool []string, h string) bool {
	return slices.Contains(pool, h)
}
