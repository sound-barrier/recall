package fixtures

import (
	"math/rand"
	"time"

	"recall/pkg/db"
)

// appendUserMatchVariants seeds the user-override layer so a seeded profile
// exercises all three provenance states:
//   - a user-corrected damage number on ~12% of OCR matches (→ ocr_edited);
//   - a batch of hand-entered matches with no screenshot rows (→ manual), each
//     carrying realistic map / hero / result, a primary-hero list, queue /
//     play-mode seeds, and (for competitive) a rank.
//
// Values are sampled from the already-generated OCR corpus so they stay
// plausible. Deterministic for a given seed.
func (fx *Fixture) appendUserMatchVariants(seed int64) {
	if len(fx.Summaries) == 0 {
		return
	}
	// #nosec G404 -- deterministic dev fixture, not security-sensitive
	rng := rand.New(rand.NewSource(seed ^ 0x5EED))

	// Edited OCR matches — a "corrected" damage marks them ocr_edited.
	for _, s := range fx.Summaries {
		if rng.Float64() < 0.12 {
			dmg := 2500 + rng.Intn(9000)
			fx.UserData = append(fx.UserData, db.UserMatchData{MatchKey: s.MatchKey, Damage: &dmg})
		}
	}

	// Hand-entered (manual) matches — fresh keys with no screenshot rows.
	existing := make(map[string]bool, len(fx.Summaries))
	for _, s := range fx.Summaries {
		existing[s.MatchKey] = true
	}
	start, end := fixtureDateRange()
	totalDays := int(end.Sub(start).Hours()/24) + 1
	results := []string{"victory", "defeat", "draw"}
	tiers := []string{"gold", "platinum", "diamond"}

	manualN := max(len(fx.Summaries)/8, 4)
	for range manualN {
		key, t := mintManualKey(rng, start, totalDays, existing)
		if key == "" {
			continue
		}
		existing[key] = true

		src := fx.Summaries[rng.Intn(len(fx.Summaries))]
		mapName, hero := src.Map, src.Hero
		result := results[rng.Intn(len(results))]
		date := t.Format("2006-01-02")
		finished := t.Format("15:04")
		ud := db.UserMatchData{
			MatchKey:   key,
			Map:        &mapName,
			Hero:       &hero,
			Result:     &result,
			Date:       &date,
			FinishedAt: &finished,
			Heroes:     []db.UserMatchHero{{Hero: hero, Position: 0}},
		}

		queue := "role"
		if rng.Float64() < 0.2 {
			queue = "open"
		}
		mode := "competitive"
		if rng.Float64() < 0.15 {
			mode = "quickplay"
		}
		if mode == "competitive" {
			tier := tiers[rng.Intn(len(tiers))]
			level := 1 + rng.Intn(5)
			progress := rng.Intn(100)
			ud.Rank = &tier
			ud.Level = &level
			ud.RankProgress = &progress
		}

		fx.UserData = append(fx.UserData, ud)
		fx.Queues = append(fx.Queues, QueueSeed{MatchKey: key, QueueType: queue})
		fx.PlayModes = append(fx.PlayModes, PlayModeSeed{MatchKey: key, PlayMode: mode})
	}
}

// mintManualKey returns a `match-<ts>` key + its time, within the fixture date
// range and not colliding with an existing key. Returns ("", zero) if it can't
// find a free slot in a bounded number of tries (vanishingly unlikely).
func mintManualKey(rng *rand.Rand, start time.Time, totalDays int, existing map[string]bool) (string, time.Time) {
	for range 50 {
		d := start.AddDate(0, 0, rng.Intn(totalDays))
		t := time.Date(d.Year(), d.Month(), d.Day(), rng.Intn(24), rng.Intn(60), rng.Intn(60), 0, time.UTC)
		key := "match-" + t.Format("2006-01-02T15-04-05")
		if !existing[key] {
			return key, t
		}
	}
	return "", time.Time{}
}
