package fixtures

import (
	"fmt"
	"math/rand"
	"time"

	"recall/pkg/db"
	"recall/pkg/match"
	"recall/pkg/parser"
)

// matchSpec bundles the caller-planned inputs for one generated match:
// who is playing (profile), where (md), when (t), the pre-planned
// mode/queue for the slot, and the previous match's hero for
// consecutive-pick damping.
type matchSpec struct {
	profile   playerProfile
	md        mapDistribution
	t         time.Time
	playMode  string
	queueType string
	prevHero  string
}

// emitState keeps the parallel queue/play-mode slices aligned with
// fx.Summaries by emit order — appended only when a summary row lands,
// consumed by appendQueueAndPlayModeSeeds and the rank post-pass.
type emitState struct {
	queueTypes []string
	playModes  []string
}

// matchPlan is everything the per-match dice decided. FinalScore is
// deliberately NOT here: its rolls happen inside the summary emit
// branch, and hoisting them would shift the RNG stream for every
// seeded corpus (the seed-pinned story test would flag it).
type matchPlan struct {
	spec         matchSpec
	primary      heroPlay
	heroesPlayed []db.SummaryHeroPlayed
	key          string
	ts           string
	day          string
	finishedAt   string
	gameMap      string
	result       string
	gameLength   string
	elims        int
	assists      int
	deaths       int
	gameMinutes  int
	damage       int
	healing      int
	mitigation   int
	hasSummary   bool
	hasTeams     bool
	hasPersonal  bool
}

// planMatch rolls one match's dice in the exact historical order —
// heroes, map, result, combat line, capture habits, damage profile —
// so seeded corpora reproduce byte-for-byte.
func planMatch(rng *rand.Rand, spec matchSpec) matchPlan {
	plays := pickMatchHeroes(rng, spec.profile, spec.prevHero, spec.playMode, spec.queueType)
	p := matchPlan{
		spec:       spec,
		primary:    plays[0],
		day:        spec.t.Format("2006-01-02"),
		ts:         spec.t.Format("2006-01-02T15-04-05"),
		finishedAt: spec.t.Format("15:04:05"),
	}
	p.key = match.NewTrackedMatchKey(p.ts).String()
	p.gameMap = spec.md.pick(rng)
	p.result = pickWeightedResult(rng)

	p.elims = 6 + rng.Intn(20)
	p.assists = 4 + rng.Intn(12)
	p.deaths = 2 + rng.Intn(9)
	p.gameMinutes = 8 + rng.Intn(12)
	gameSeconds := rng.Intn(60)
	p.gameLength = fmt.Sprintf("%02d:%02d", p.gameMinutes, gameSeconds)
	totalGameSec := p.gameMinutes*60 + gameSeconds

	p.heroesPlayed = make([]db.SummaryHeroPlayed, 0, len(plays))
	for _, hp := range plays {
		p.heroesPlayed = append(p.heroesPlayed, db.SummaryHeroPlayed{
			Hero:          hp.Hero,
			PercentPlayed: hp.Percent,
			PlayTime:      formatPlayTime(totalGameSec, hp.Percent),
		})
	}

	// Per-match screenshot-type dice. Models realistic capture habits:
	// SUMMARY is the most common (~95% — post-match screen is what the
	// user almost always remembers to grab), TEAMS ~80% (requires opening
	// the teams), PERSONAL ~70% (Tab during the game). Independent rolls so
	// a match can land in any combination — including the missing-summary
	// and missing-teams cases the dossier needs to handle. Floor: if all
	// three roll false, force summary so every planned match has at least
	// one screenshot row. RANK is NOT rolled here — competitive rank
	// readings are emitted by applyRankProgression as a post-pass so they
	// form a coherent per-track climb instead of random per-match noise.
	p.hasSummary = rng.Float64() < 0.95
	p.hasTeams = rng.Float64() < 0.80
	p.hasPersonal = rng.Float64() < 0.70
	if !p.hasSummary && !p.hasTeams && !p.hasPersonal {
		p.hasSummary = true
	}

	p.damage = 4000 + rng.Intn(12000)
	switch p.primary.Role {
	case "support":
		p.healing = 6000 + rng.Intn(8000)
	case "tank":
		p.mitigation = 5000 + rng.Intn(12000)
	}
	return p
}

// appendGeneratedMatch plans one match's dice and emits its screenshot
// rows, keeping emit's parallel slices aligned with fx.Summaries.
// Returns the match's primary hero so the caller can thread it as the
// next match's prevHero.
func (fx *Fixture) appendGeneratedMatch(rng *rand.Rand, spec matchSpec, emit *emitState) string {
	p := planMatch(rng, spec)
	if p.hasSummary {
		fx.appendPlannedSummary(rng, p, emit)
	}
	if p.hasTeams {
		fx.appendPlannedTeams(p)
	}
	if p.hasPersonal {
		fx.appendPlannedPersonal(p)
	}
	return p.primary.Hero
}

func (fx *Fixture) appendPlannedSummary(rng *rand.Rand, p matchPlan, emit *emitState) {
	fx.Summaries = append(fx.Summaries, db.SummaryRow{
		ParserGeneration:       parser.Generation,
		Filename:               "summary-" + p.ts + ".png",
		MatchKey:               p.key,
		Map:                    p.gameMap,
		Playlist:               p.spec.playMode,
		Hero:                   p.primary.Hero,
		Result:                 p.result,
		FinalScore:             fmt.Sprintf("%d-%d", rng.Intn(5), rng.Intn(5)),
		Date:                   p.day,
		FinishedAt:             p.finishedAt,
		GameLength:             p.gameLength,
		PerfElimTotal:          p.elims,
		PerfElimAvgPer10Min:    float64(p.elims) * 10.0 / float64(p.gameMinutes),
		PerfAssistsTotal:       p.assists,
		PerfAssistsAvgPer10Min: float64(p.assists) * 10.0 / float64(p.gameMinutes),
		PerfDeathsTotal:        p.deaths,
		PerfDeathsAvgPer10Min:  float64(p.deaths) * 10.0 / float64(p.gameMinutes),
		HeroesPlayed:           p.heroesPlayed,
	})
	emit.queueTypes = append(emit.queueTypes, p.spec.queueType)
	emit.playModes = append(emit.playModes, p.spec.playMode)
}

func (fx *Fixture) appendPlannedTeams(p matchPlan) {
	fx.Teams = append(fx.Teams, db.TeamsRow{
		ParserGeneration: parser.Generation,
		Filename:         "teams-" + p.ts + ".png",
		MatchKey:         p.key,
		Eliminations:     p.elims,
		Assists:          p.assists,
		Deaths:           p.deaths,
		Damage:           p.damage,
		Healing:          p.healing,
		Mitigation:       p.mitigation,
		// Mirror real parsing: the teams carries the detected
		// queue, so a match surfaces a queue even without a user
		// override (the Queues seed is the override subset).
		QueueType: p.spec.queueType,
	})
}

func (fx *Fixture) appendPlannedPersonal(p matchPlan) {
	fx.Personals = append(fx.Personals, db.PersonalRow{
		ParserGeneration: parser.Generation,
		Filename:         "personal-" + p.ts + ".png",
		MatchKey:         p.key,
		Hero:             p.primary.Hero,
		HeroStats: []db.HeroStat{
			{Hero: p.primary.Hero, StatKey: "eliminations", StatValue: p.elims},
			{Hero: p.primary.Hero, StatKey: "deaths", StatValue: p.deaths},
			{Hero: p.primary.Hero, StatKey: "damage", StatValue: p.damage},
		},
	})
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
	for range unknownCount {
		dayIdx := sampleWeightedIndex(unknownRng, dayWeights, totalDayW)
		day := rangeStart.AddDate(0, 0, dayIdx)
		h := pickWeightedHour(unknownRng)
		m := unknownRng.Intn(60)
		s := unknownRng.Intn(60)
		t := time.Date(day.Year(), day.Month(), day.Day(), h, m, s, 0, time.UTC)
		filename := "unknown-" + t.Format("2006-01-02T15-04-05") + ".png"
		fx.Unknowns = append(fx.Unknowns, db.UnknownRow{
			ParserGeneration: parser.Generation,
			Filename:         filename,
			MatchKey:         match.NewUnmatchedMatchKey(filename).String(),
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
		if mk, err := match.ParseKey(s.MatchKey); err == nil && mk.IsTracked() {
			trackedKeys = append(trackedKeys, s.MatchKey)
		}
	}
	if len(trackedKeys) < 3 {
		return
	}
	ambiguousCount := n / 100
	for range ambiguousCount {
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
			ParserGeneration: parser.Generation,
			Filename:         filename,
			MatchKey:         matchKey,
			Eliminations:     6 + ambigRng.Intn(20),
			Assists:          4 + ambigRng.Intn(12),
			Deaths:           2 + ambigRng.Intn(9),
			Damage:           4000 + ambigRng.Intn(12000),
		})
		fx.Ambiguous = append(fx.Ambiguous, AmbiguousSeed{
			Filename:   filename,
			Candidates: cands,
		})
	}
}
