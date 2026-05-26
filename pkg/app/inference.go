package app

import (
	"recall/pkg/metrics"
	"recall/pkg/parser"
)

// scrapeReader returns every match in the DB as a slice of metrics.ScrapeRow.
// Called by the Prometheus collector on every scrape; the read is the same
// SELECT that backs GetMatchResults, so cardinality and freshness are
// identical between the Wails UI and the metrics endpoint.
func (a *App) scrapeReader() ([]metrics.ScrapeRow, error) {
	recs, err := a.aggregateAll()
	if err != nil {
		return nil, err
	}
	out := make([]metrics.ScrapeRow, len(recs))
	for i, r := range recs {
		inferSoleHeroPercent(&r.Data)
		inferResultFromRank(&r.Data)
		out[i] = metrics.ScrapeRow{MatchKey: r.MatchKey, Data: r.Data}
	}
	return out, nil
}

// inferSoleHeroPercent fills percent_played for matches where only one hero
// is on record. Scoreboard-only rows (no SUMMARY screenshot captured) have a
// single HeroesPlayed entry with PercentPlayed=0 because that field only
// comes from the SUMMARY tab — if there's just one hero, they were played
// for the whole match.
//
// READ-TIME ONLY (load-bearing). Applied via GetMatchResults / scrapeReader,
// never inside mergeMatchResult or upsertMergedRow. Storing the inferred
// value would lock it in via the first-non-zero-wins merge rule when a
// later SUMMARY screenshot arrives with the real percentage. The invariant
// is locked by TestInference_NeverPersistedToStore in
// inference_invariant_test.go.
func inferSoleHeroPercent(d *parser.MatchResult) {
	if len(d.HeroesPlayed) != 1 {
		return
	}
	hp := &d.HeroesPlayed[0]
	if hp.PercentPlayed == 0 && hp.PlayTime == "" {
		hp.PercentPlayed = 100
	}
}

// inferResultFromRank fills Result for rows that have rank-screen data but
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
func inferResultFromRank(d *parser.MatchResult) {
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
