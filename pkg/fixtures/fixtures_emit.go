package fixtures

import (
	"fmt"
	"math/rand"
	"time"

	"recall/pkg/db"
	"recall/pkg/match"
)

// appendGeneratedMatch builds one match's screenshot rows (driven by the
// per-match capture-habit dice) and appends them to fx, keeping the
// parallel queue/play-mode slices aligned with fx.Summaries. Returns the
// match's primary hero so the caller can thread it as the next match's
// prevHero.
func (fx *Fixture) appendGeneratedMatch(rng *rand.Rand, profile playerProfile, md mapDistribution, t time.Time, playMode, queueType, prevHero string, summaryQueueTypes, summaryPlayModes *[]string) string {
	day := t.Format("2006-01-02")
	plays := pickMatchHeroes(rng, profile, prevHero, playMode, queueType)
	primary := plays[0]

	ts := t.Format("2006-01-02T15-04-05")
	finishedAt := t.Format("15:04:05")
	key := match.NewTrackedMatchKey(ts).String()

	gameMap := md.pick(rng)
	result := pickWeightedResult(rng)

	elims := 6 + rng.Intn(20)
	assists := 4 + rng.Intn(12)
	deaths := 2 + rng.Intn(9)
	gameMinutes := 8 + rng.Intn(12)
	gameSeconds := rng.Intn(60)
	gameLength := fmt.Sprintf("%02d:%02d", gameMinutes, gameSeconds)
	totalGameSec := gameMinutes*60 + gameSeconds

	heroesPlayed := make([]db.SummaryHeroPlayed, 0, len(plays))
	for _, p := range plays {
		heroesPlayed = append(heroesPlayed, db.SummaryHeroPlayed{
			Hero:          p.Hero,
			PercentPlayed: p.Percent,
			PlayTime:      formatPlayTime(totalGameSec, p.Percent),
		})
	}

	// Per-match screenshot-type dice. Models realistic capture habits:
	// SUMMARY is the most common (~95% — post-match screen is what the
	// user almost always remembers to grab), TEAMS ~80% (requires opening
	// the teams), PERSONAL ~70% (Tab during the game), RANK ~15% (only at
	// end-of-game rank-up screens). Independent rolls so a match can land
	// in any combination — including the missing-summary and missing-teams
	// cases the dossier needs to handle. Floor: if all four roll false,
	// force summary so every planned match has at least one screenshot row.
	hasSummary := rng.Float64() < 0.95
	hasTeams := rng.Float64() < 0.80
	hasPersonal := rng.Float64() < 0.70
	hasRank := rng.Float64() < 0.15
	if !hasSummary && !hasTeams && !hasPersonal && !hasRank {
		hasSummary = true
	}

	damage := 4000 + rng.Intn(12000)
	healing := 0
	mitigation := 0
	switch primary.Role {
	case "support":
		healing = 6000 + rng.Intn(8000)
	case "tank":
		mitigation = 5000 + rng.Intn(12000)
	}

	if hasSummary {
		fx.Summaries = append(fx.Summaries, db.SummaryRow{
			Filename:               "summary-" + ts + ".png",
			MatchKey:               key,
			Map:                    gameMap,
			Playlist:               playMode,
			Hero:                   primary.Hero,
			Result:                 result,
			FinalScore:             fmt.Sprintf("%d-%d", rng.Intn(5), rng.Intn(5)),
			Date:                   day,
			FinishedAt:             finishedAt,
			GameLength:             gameLength,
			PerfElimTotal:          elims,
			PerfElimAvgPer10Min:    float64(elims) * 10.0 / float64(gameMinutes),
			PerfAssistsTotal:       assists,
			PerfAssistsAvgPer10Min: float64(assists) * 10.0 / float64(gameMinutes),
			PerfDeathsTotal:        deaths,
			PerfDeathsAvgPer10Min:  float64(deaths) * 10.0 / float64(gameMinutes),
			HeroesPlayed:           heroesPlayed,
		})
		*summaryQueueTypes = append(*summaryQueueTypes, queueType)
		*summaryPlayModes = append(*summaryPlayModes, playMode)
	}

	if hasTeams {
		fx.Teams = append(fx.Teams, db.TeamsRow{
			Filename:     "teams-" + ts + ".png",
			MatchKey:     key,
			Eliminations: elims,
			Assists:      assists,
			Deaths:       deaths,
			Damage:       damage,
			Healing:      healing,
			Mitigation:   mitigation,
			// Mirror real parsing: the teams carries the detected
			// queue, so a match surfaces a queue even without a user
			// override (the Queues seed is the override subset).
			QueueType: queueType,
		})
	}

	if hasPersonal {
		fx.Personals = append(fx.Personals, db.PersonalRow{
			Filename: "personal-" + ts + ".png",
			MatchKey: key,
			Hero:     primary.Hero,
			HeroStats: []db.HeroStat{
				{Hero: primary.Hero, StatKey: "eliminations", StatValue: elims},
				{Hero: primary.Hero, StatKey: "deaths", StatValue: deaths},
				{Hero: primary.Hero, StatKey: "damage", StatValue: damage},
			},
		})
	}

	if hasRank {
		fx.Ranks = append(fx.Ranks, db.RankRow{
			Filename:      "rank-" + ts + ".png",
			MatchKey:      key,
			Rank:          fixtureRanks[rng.Intn(len(fixtureRanks))],
			Level:         1 + rng.Intn(5),
			RankProgress:  rng.Intn(100),
			ChangePercent: rng.Intn(40) - 20,
			Result:        result,
			SR: []db.HeroSR{{
				Hero:   primary.Hero,
				SR:     2000 + rng.Intn(2000),
				Change: rng.Intn(40) - 20,
			}},
		})
	}
	return primary.Hero
}

// appendReviewSeeds seeds review rows on ~1.5% of summaries (70% self,
// 30% coach) via a derived RNG (seed+2) so changing the review rate
// doesn't shift the main corpus.
func (fx *Fixture) appendReviewSeeds(seed int64) {
	// #nosec G404 -- deterministic dev fixture, not security-sensitive
	reviewRng := rand.New(rand.NewSource(seed + 2))
	for _, s := range fx.Summaries {
		if reviewRng.Float64() >= 0.015 {
			continue
		}
		reviewedBy := "self"
		if reviewRng.Float64() < 0.3 {
			reviewedBy = "coach"
		}
		fx.Reviews = append(fx.Reviews, ReviewSeed{
			MatchKey:   s.MatchKey,
			ReviewedBy: reviewedBy,
		})
	}
}

// appendQueueAndPlayModeSeeds installs the per-summary queue-type +
// play-mode override rows, deduped on match_key. The parallel slices align
// with fx.Summaries by emit order; the index guard stops at the summary
// count (ambiguous teams appended later have no summary entry).
func (fx *Fixture) appendQueueAndPlayModeSeeds(summaryQueueTypes, summaryPlayModes []string) {
	queueSeen := make(map[string]bool, len(fx.Summaries))
	for i, s := range fx.Summaries {
		if i >= len(summaryQueueTypes) {
			break
		}
		if queueSeen[s.MatchKey] {
			continue
		}
		queueSeen[s.MatchKey] = true
		fx.Queues = append(fx.Queues, QueueSeed{
			MatchKey:  s.MatchKey,
			QueueType: summaryQueueTypes[i],
		})
	}
	pmSeen := make(map[string]bool, len(fx.Summaries))
	for i, s := range fx.Summaries {
		if i >= len(summaryPlayModes) {
			break
		}
		if pmSeen[s.MatchKey] {
			continue
		}
		pmSeen[s.MatchKey] = true
		fx.PlayModes = append(fx.PlayModes, PlayModeSeed{
			MatchKey: s.MatchKey,
			PlayMode: summaryPlayModes[i],
		})
	}
}

// appendUnknownScreenshots seeds ~2% of N unknown rows (captures Tesseract
// couldn't classify) via a derived RNG (seed+5). The unmatched- match_key
// is what the parser would mint for a file without a parseable timestamp.
func (fx *Fixture) appendUnknownScreenshots(seed int64, n int, rangeStart time.Time, dayWeights []float64, totalDayW float64) {
	// #nosec G404 -- deterministic dev fixture, not security-sensitive
	unknownRng := rand.New(rand.NewSource(seed + 5))
	unknownCount := n * 2 / 100
	for i := 0; i < unknownCount; i++ {
		dayIdx := sampleWeightedIndex(unknownRng, dayWeights, totalDayW)
		day := rangeStart.AddDate(0, 0, dayIdx)
		h := pickWeightedHour(unknownRng)
		m := unknownRng.Intn(60)
		s := unknownRng.Intn(60)
		t := time.Date(day.Year(), day.Month(), day.Day(), h, m, s, 0, time.UTC)
		filename := "unknown-" + t.Format("2006-01-02T15-04-05") + ".png"
		fx.Unknowns = append(fx.Unknowns, db.UnknownRow{
			Filename: filename,
			MatchKey: match.NewUnmatchedMatchKey(filename).String(),
		})
	}
}

// appendAmbiguousScreenshots seeds ~1% of N ambiguous teams rows — EAD
// signatures that matched multiple candidates in the resolver's window —
// each pointing at 2-3 tracked match_keys (seed+6). Skipped if the corpus
// has fewer than 3 tracked matches (no candidates to point at).
func (fx *Fixture) appendAmbiguousScreenshots(seed int64, n int, rangeStart time.Time, dayWeights []float64, totalDayW float64) {
	// #nosec G404 -- deterministic dev fixture, not security-sensitive
	ambigRng := rand.New(rand.NewSource(seed + 6))
	trackedKeys := make([]string, 0, len(fx.Summaries))
	for _, s := range fx.Summaries {
		if mk, err := match.ParseMatchKey(s.MatchKey); err == nil && mk.IsTracked() {
			trackedKeys = append(trackedKeys, s.MatchKey)
		}
	}
	if len(trackedKeys) < 3 {
		return
	}
	ambiguousCount := n / 100
	for i := 0; i < ambiguousCount; i++ {
		dayIdx := sampleWeightedIndex(ambigRng, dayWeights, totalDayW)
		day := rangeStart.AddDate(0, 0, dayIdx)
		h := pickWeightedHour(ambigRng)
		m := ambigRng.Intn(60)
		sc := ambigRng.Intn(60)
		t := time.Date(day.Year(), day.Month(), day.Day(), h, m, sc, 0, time.UTC)
		filename := "teams-" + t.Format("2006-01-02T15-04-05") + ".png"
		matchKey := match.NewAmbiguousMatchKey(filename).String()
		// Pick 2-3 candidate tracked match_keys at random; distances are
		// illustrative (1-30 min, the EAD bridge window).
		candCount := 2 + ambigRng.Intn(2)
		perm := ambigRng.Perm(len(trackedKeys))
		cands := make([]db.AmbiguousCandidate, 0, candCount)
		for j := 0; j < candCount && j < len(perm); j++ {
			cands = append(cands, db.AmbiguousCandidate{
				MatchKey:        trackedKeys[perm[j]],
				DistanceSeconds: 60 + ambigRng.Intn(29*60),
			})
		}
		// Emit a teams-shaped row so the read path has something to
		// attach the candidates to. Stats are uniformly random — the
		// resolver UI doesn't care about teams contents, only that the
		// row exists.
		fx.Teams = append(fx.Teams, db.TeamsRow{
			Filename:     filename,
			MatchKey:     matchKey,
			Eliminations: 6 + ambigRng.Intn(20),
			Assists:      4 + ambigRng.Intn(12),
			Deaths:       2 + ambigRng.Intn(9),
			Damage:       4000 + ambigRng.Intn(12000),
		})
		fx.Ambiguous = append(fx.Ambiguous, AmbiguousSeed{
			Filename:   filename,
			Candidates: cands,
		})
	}
}
