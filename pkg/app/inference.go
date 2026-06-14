package app

import (
	"recall/pkg/aggregate"
	"recall/pkg/metrics"
)

// scrapeReader returns every non-hidden match in the DB as a slice of
// metrics.ScrapeRow. Called by the Prometheus collector on every scrape;
// the read is the same SELECT that backs GetMatchResults, then hidden
// matches are filtered out so Grafana trends reconcile with the in-app
// dossier / heatmap / sparkline (which also drop hidden).
func (a *App) scrapeReader() ([]metrics.ScrapeRow, error) {
	recs, err := a.aggregateAll()
	if err != nil {
		return nil, err
	}
	out := make([]metrics.ScrapeRow, 0, len(recs))
	for _, r := range recs {
		if r.Hidden {
			continue
		}
		aggregate.InferSoleHeroPercent(&r.Data)
		aggregate.InferResultFromRank(&r.Data)
		out = append(out, metrics.ScrapeRow{MatchKey: r.MatchKey, Data: r.Data})
	}
	return out, nil
}

// aggregate.InferSoleHeroPercent fills percent_played for matches where only one hero
// is on record. Teams-only rows (no SUMMARY screenshot captured) have a
// single HeroesPlayed entry with PercentPlayed=0 because that field only
// comes from the SUMMARY tab — if there's just one hero, they were played
// for the whole match.
//
// READ-TIME ONLY (load-bearing). Applied via GetMatchResults / scrapeReader,
// never inside correlate.MergeMatchResult or upsertMergedRow. Storing the inferred
// value would lock it in via the first-non-zero-wins merge rule when a
// later SUMMARY screenshot arrives with the real percentage. The invariant
// is locked by TestInference_NeverPersistedToStore in
// inference_invariant_test.go.
