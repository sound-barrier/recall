package app

import (
	"math/rand"

	"recall/pkg/db"
)

// ensureCoverage patches the fixture so every map in fixtureMaps
// and every hero across the three role pools appears in at least one
// summary. Called only for flex corpuses (the other styles can't
// satisfy this by definition).
//
// Strategy: scan once for what's present, build a list of missing
// values, then pick random summary indices (without replacement) and
// overwrite their Map / Hero in lockstep on the matching teams.
// We don't touch personal / rank rows — those are role-stats and a
// minor inconsistency on the patched matches reads as "the player
// tried something off-spec" rather than as a bug.
func ensureCoverage(rng *rand.Rand, fx *Fixture, queueTypes []string) {
	missingMaps, missingHeroes := coverageGaps(fx)
	if len(missingMaps) == 0 && len(missingHeroes) == 0 {
		return
	}
	p := newCoveragePatcher(rng, fx, queueTypes)
	for _, m := range missingMaps {
		if !p.applyMap(m) {
			break
		}
	}
	for _, h := range missingHeroes {
		hero := h
		heroRole := roleOfHero(hero)
		// Append the missing hero as a 5% cameo on an eligible match
		// (open queue, or role queue whose primary matches the cameo's
		// role) and dock the primary by 5% so percent_played still
		// sums to 100. We don't touch s.Hero / sb.Hero: the cameo is
		// "tried this for a minute" — the primary still owns the
		// match identity.
		if !p.applyHeroCameo(heroRole, func(s *db.SummaryRow) {
			const cameoPct = 5
			if len(s.HeroesPlayed) == 0 {
				s.HeroesPlayed = append(s.HeroesPlayed, db.SummaryHeroPlayed{
					Hero:          hero,
					PercentPlayed: 100,
					PlayTime:      "1:00",
				})
				return
			}
			if s.HeroesPlayed[0].PercentPlayed > cameoPct+5 {
				s.HeroesPlayed[0].PercentPlayed -= cameoPct
			}
			s.HeroesPlayed = append(s.HeroesPlayed, db.SummaryHeroPlayed{
				Hero:          hero,
				PercentPlayed: cameoPct,
				PlayTime:      "0:30",
			})
		}) {
			break
		}
	}
}

// coverageGaps returns the maps + heroes from the pools that no summary
// currently shows.
func coverageGaps(fx *Fixture) (missingMaps, missingHeroes []string) {
	mapsSeen := make(map[string]bool, len(fixtureMaps))
	heroesSeen := make(map[string]bool, len(fixtureTanks)+len(fixtureSupports)+len(fixtureDPS))
	for _, s := range fx.Summaries {
		mapsSeen[s.Map] = true
		for _, hp := range s.HeroesPlayed {
			heroesSeen[hp.Hero] = true
		}
	}
	for _, m := range fixtureMaps {
		if !mapsSeen[m] {
			missingMaps = append(missingMaps, m)
		}
	}
	for _, pool := range [][]string{fixtureTanks, fixtureSupports, fixtureDPS} {
		for _, h := range pool {
			if !heroesSeen[h] {
				missingHeroes = append(missingHeroes, h)
			}
		}
	}
	return missingMaps, missingHeroes
}

// coveragePatcher overwrites a few summary rows so every map + hero in the
// pools appears at least once. It walks ONE shared permutation (cursor)
// across both the map pass and the hero-cameo pass so they don't clobber
// each other.
type coveragePatcher struct {
	fx         *Fixture
	queueTypes []string
	patchOrder []int
	cursor     int
	mapCounts  map[string]int
}

func newCoveragePatcher(rng *rand.Rand, fx *Fixture, queueTypes []string) *coveragePatcher {
	mapCounts := make(map[string]int, len(fixtureMaps))
	for _, s := range fx.Summaries {
		mapCounts[s.Map]++
	}
	return &coveragePatcher{
		fx:         fx,
		queueTypes: queueTypes,
		patchOrder: rng.Perm(len(fx.Summaries)),
		mapCounts:  mapCounts,
	}
}

// applyMap overwrites the next slot's Map with gameMap. Map patches are
// queue-agnostic, but a slot whose current map is its only instance is
// skipped (overwriting it would move that map from present → missing).
func (p *coveragePatcher) applyMap(gameMap string) bool {
	for p.cursor < len(p.patchOrder) {
		idx := p.patchOrder[p.cursor]
		s := &p.fx.Summaries[idx]
		if p.mapCounts[s.Map] <= 1 {
			p.cursor++
			continue
		}
		p.mapCounts[s.Map]--
		p.mapCounts[gameMap]++
		s.Map = gameMap
		p.cursor++
		return true
	}
	return false
}

// applyHeroCameo runs rewrite on the next slot that can host an off-role
// cameo of heroRole (open queue, OR a role queue whose primary already
// matches heroRole — a 5% off-role cameo on a role-queue match would
// violate the single-role constraint). Ineligible slots are rotated to the
// end so later cameos with different roles can use them.
func (p *coveragePatcher) applyHeroCameo(heroRole string, rewrite func(s *db.SummaryRow)) bool {
	for p.cursor < len(p.patchOrder) {
		idx := p.patchOrder[p.cursor]
		s := &p.fx.Summaries[idx]
		qt := ""
		if idx < len(p.queueTypes) {
			qt = p.queueTypes[idx]
		}
		eligible := qt != "role" || roleOfHero(s.Hero) == heroRole
		if eligible {
			p.cursor++
			rewrite(s)
			return true
		}
		p.patchOrder = append(p.patchOrder[:p.cursor], p.patchOrder[p.cursor+1:]...)
	}
	return false
}
