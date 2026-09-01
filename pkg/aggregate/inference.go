package aggregate

import (
	"recall/pkg/parser"
)

// InferSoleHeroPercent fills percent_played for matches where only one hero
// is on record. Teams-only rows (no SUMMARY screenshot captured) have a
// single HeroesPlayed entry with PercentPlayed=0 because that field only
// comes from the SUMMARY tab — if there's just one hero, they were played
// for the whole match.
//
// READ-TIME ONLY: applied via GetMatchResults, never inside the merge path,
// so a later SUMMARY screenshot's real percentage isn't shadowed.
func InferSoleHeroPercent(d *parser.MatchResult) {
	if len(d.HeroesPlayed) != 1 {
		return
	}
	hp := &d.HeroesPlayed[0]
	if hp.PercentPlayed == 0 && hp.PlayTime == "" {
		hp.PercentPlayed = 100
	}
}

// InferResultFromRank fills Result for rows that have rank-screen data but
// where the COMPETITIVE VICTORY/DEFEAT/DRAW banner OCR missed. The italic
// stylized banner is the parser's primary signal but it's the most brittle
// piece of the rank screen — when it fails, the signed SR delta on the same
// screenshot is the next-best signal.
//
// READ-TIME ONLY (load-bearing). Applied via GetMatchResults, never inside
// the merge path. If a later SUMMARY screenshot's authoritative
// Result is "defeat" but an earlier rank screenshot's positive SR change
// triggered an inferred "victory", the SUMMARY value must win — which it
// does because nothing inferred ever reaches the store. The invariant is
// locked by TestInference_NeverPersistedToStore and
// TestInference_DoesNotOverrideStoredResult in inference_invariant_test.go.
func InferResultFromRank(d *parser.MatchResult) {
	if d.Result != "" || len(d.SR) == 0 {
		return
	}
	for _, s := range d.SR {
		// An unread pill infers nothing. It used to arrive as 0 and fall
		// through both branches by accident; now it is nil and says so.
		if s.Change == nil {
			continue
		}
		if *s.Change > 0 {
			d.Result = "victory"
			return
		}
		if *s.Change < 0 {
			d.Result = "defeat"
			return
		}
	}
}

// InferPerformanceTotals fills the SUMMARY performance panel's totals from the
// match's E/A/D. The panel and the scalars are two readings of ONE fact, so
// only one of them is stored — and this is the read-time step that makes the
// other agree with it. That is what keeps a correction whole: an eliminations
// override moves the scalar, and the panel follows.
//
// A match with no SUMMARY screenshot has no panel and does not grow one here —
// nothing observed its per-10-minute rates, and inventing a block of zeroes
// would claim otherwise.
//
// READ-TIME ONLY, like its siblings: nothing derived ever reaches the store.
func InferPerformanceTotals(d *parser.MatchResult) {
	if d.Performance == nil {
		return
	}
	d.Performance.Eliminations.Total = d.Eliminations
	d.Performance.Assists.Total = d.Assists
	d.Performance.Deaths.Total = d.Deaths
}

// ApplyReadTimeInference runs every read-time inference over one match, in the
// order they depend on each other. Every read path calls THIS — the store-backed
// one in pkg/app, the bundle-backed one the film room builds, and the per-key
// extract behind the live "match-updated" event — so a new inference cannot
// reach two of the three and be missing from the third.
func ApplyReadTimeInference(d *parser.MatchResult) {
	InferSoleHeroPercent(d)
	InferResultFromRank(d)
	InferPerformanceTotals(d)
}
