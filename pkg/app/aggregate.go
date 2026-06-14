package app

import (
	"recall/pkg/aggregate"
	"recall/pkg/match"
	"recall/pkg/parser"
)

// aggregateAll bulk-reads every screenshot row, groups by match_key,
// folds each group into one match.MatchRecord via correlate.MergeMatchResult, and runs
// the read-time inference helpers.
//
// Read-time only: never mutates DB rows. The same precedence rules
// the old destructive merge applied at write time now run at read
// time over the typed parent rows; raw per-screenshot data stays
// available for replay (e.g. when a new SUMMARY arrives for an old
// match that was teams-only).
// reAggregateUnknowns walks every per-screenshot row whose canonical
// hero/map is empty but whose raw OCR is preserved, re-runs the
// parser's matchers against the CURRENT heroes.yaml / maps.yaml
// rosters, and promotes any newly-recognised rows to canonical.
//
// Cheap pure-CPU pass — one in-memory matcher invocation per
// unknown row, then one UPDATE per hit. ~2–5 s on a 500-match
// corpus typical. Runs at App.Startup so a YAML release that adds
// a new hero/map retroactively fixes the user's Unknown bucket
// without forcing a Tesseract re-run.
//
// Forward-only: rows written before this feature shipped have
// hero_raw=” / map_raw=” and participate in the walk only as
// no-ops. To recover the older Mei-misattribution backlog,
// Settings → Advanced → Re-parse all screenshots is the only
// path (it re-runs Tesseract, which now correctly rejects the
// short-name fuzzy match).
func (a *App) reAggregateUnknowns() (int, error) {
	return a.store.ReAggregateUnknowns(parser.FirstKnownHeroIn, parser.FirstKnownMapIn)
}

func (a *App) aggregateAll() ([]match.MatchRecord, error) {
	snap, err := a.store.LoadAll()
	if err != nil {
		return nil, err
	}
	annos, err := a.store.LoadAnnotations()
	if err != nil {
		return nil, err
	}
	hidden, err := a.store.LoadHiddenKeys()
	if err != nil {
		return nil, err
	}
	reviews, err := a.store.LoadReviews()
	if err != nil {
		return nil, err
	}
	queues, err := a.store.LoadMatchQueues()
	if err != nil {
		return nil, err
	}
	playModes, err := a.store.LoadMatchPlayModes()
	if err != nil {
		return nil, err
	}
	recs := aggregate.AggregateScreenshots(snap)
	aggregate.AttachAnnotations(recs, annos)
	aggregate.AttachHidden(recs, hidden)
	aggregate.AttachReviews(recs, reviews)
	aggregate.AttachQueues(recs, queues)
	aggregate.AttachPlayModes(recs, playModes)
	aggregate.AttachAmbiguity(recs, snap.AmbiguousCandidates)
	return recs, nil
}
