package app

import (
	"recall/pkg/aggregate"
	"recall/pkg/db"
	"recall/pkg/match"
	"recall/pkg/parser"
)

// aggregateAll bulk-reads every screenshot row, groups by match_key,
// folds each group into one match.Record via correlate.MergeMatchResult, and runs
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
// rosters, and promotes any newly-recognized rows to canonical.
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
// loadSidecars materializes the user-layer decoration maps best-effort:
// a failed load mutes annotations/flags on the result, never the
// operation itself (matching the per-file loads it replaced).
func (a *App) loadSidecars() aggregate.Sidecars {
	annos, _ := a.store.LoadAnnotations()
	hidden, _ := a.store.LoadHiddenKeys()
	reviews, _ := a.store.LoadReviews()
	pinned, _ := a.store.LoadPinnedKeys()
	coachNotes, _ := a.store.LoadMatchCoachNotes()
	moments, _ := a.store.LoadMatchMoments()
	selfReviews, _ := a.store.LoadSelfReviewNotes()
	return aggregate.Sidecars{
		Annotations: annos, Hidden: hidden, Reviews: reviews,
		Pinned: pinned, CoachNotes: coachNotes, Moments: moments, SelfReviews: selfReviews,
	}
}

func (a *App) reAggregateUnknowns() (int, error) {
	return a.store.ReAggregateUnknowns(parser.FirstKnownHeroIn, parser.FirstKnownMapIn)
}

// aggregateInputs is everything the aggregator grafts onto the screenshot
// rows. Loaded as one step so aggregateAll reads as "load, then assemble"
// rather than as twenty lines of error checks with the assembly hidden at the
// bottom. Distinct from loadSidecars above, which is the best-effort variant
// a partial read tolerates.
type aggregateInputs struct {
	snap        db.Screenshots
	annos       map[string]db.Annotation
	hidden      map[string]bool
	reviews     map[string]db.ReviewState
	pinned      map[string]bool
	queues      map[string]db.QueueState
	playModes   map[string]db.PlayModeState
	userData    map[string]db.UserMatchData
	coachNotes  map[string][]db.MatchCoachNote
	moments     map[string][]db.MatchMoment
	selfReviews map[string][]db.SelfReviewNoteOnMatch
}

func (a *App) loadAggregateInputs() (aggregateInputs, error) {
	var s aggregateInputs
	var err error
	for _, load := range []func() error{
		func() (err error) { s.snap, err = a.store.LoadAll(); return },
		func() (err error) { s.annos, err = a.store.LoadAnnotations(); return },
		func() (err error) { s.hidden, err = a.store.LoadHiddenKeys(); return },
		func() (err error) { s.reviews, err = a.store.LoadReviews(); return },
		func() (err error) { s.pinned, err = a.store.LoadPinnedKeys(); return },
		func() (err error) { s.queues, err = a.store.LoadMatchQueues(); return },
		func() (err error) { s.playModes, err = a.store.LoadMatchPlayModes(); return },
		func() (err error) { s.userData, err = a.store.LoadAllUserMatchData(); return },
		func() (err error) { s.coachNotes, err = a.store.LoadMatchCoachNotes(); return },
		func() (err error) { s.moments, err = a.store.LoadMatchMoments(); return },
		func() (err error) { s.selfReviews, err = a.store.LoadSelfReviewNotes(); return },
	} {
		if err = load(); err != nil {
			return aggregateInputs{}, err
		}
	}
	return s, nil
}

func (a *App) aggregateAll() ([]match.Record, error) {
	d, err := a.loadAggregateInputs()
	if err != nil {
		return nil, err
	}
	recs := aggregate.Screenshots(d.snap)
	recs = aggregate.SynthesizeManualMatches(recs, d.userData)
	aggregate.AttachUserData(recs, d.userData)
	aggregate.AttachAnnotations(recs, d.annos)
	aggregate.AttachHidden(recs, d.hidden)
	aggregate.AttachPinned(recs, d.pinned)
	aggregate.AttachReviews(recs, d.reviews)
	aggregate.AttachCoachNotes(recs, d.coachNotes)
	aggregate.AttachMatchMoments(recs, d.moments)
	aggregate.AttachSelfReviewNotes(recs, d.selfReviews)
	aggregate.AttachQueues(recs, d.queues)
	aggregate.AttachPlayModes(recs, d.playModes)
	aggregate.AttachAmbiguity(recs, d.snap.AmbiguousCandidates)
	return recs, nil
}
