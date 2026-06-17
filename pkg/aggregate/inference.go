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
		if s.Change > 0 {
			d.Result = "victory"
			return
		}
		if s.Change < 0 {
			d.Result = "defeat"
			return
		}
	}
}
