package aggregate

import (
	"recall/pkg/parser"
)

// scrapeReader returns every non-hidden match in the DB as a slice of
// metrics.ScrapeRow. Called by the Prometheus collector on every scrape;
// the read is the same SELECT that backs GetMatchResults, then hidden
// matches are filtered out so Grafana trends reconcile with the in-app
// dossier / heatmap / sparkline (which also drop hidden).
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
// READ-TIME ONLY (load-bearing). Applied via GetMatchResults / scrapeReader,
// never inside the merge path. If a later SUMMARY screenshot's authoritative
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
