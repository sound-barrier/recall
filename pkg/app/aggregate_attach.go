package app

import (
	"recall/pkg/db"
	"recall/pkg/match"
)

// attachReviews writes `ReviewedBy` + `ReviewedAt` on every record
// carrying a review-status row. Pure function, called once per
// aggregateAll.
func attachReviews(recs []MatchRecord, reviews map[string]db.ReviewState) {
	if len(reviews) == 0 {
		return
	}
	for i := range recs {
		if st, ok := reviews[recs[i].MatchKey]; ok {
			recs[i].ReviewedBy = st.ReviewedBy
			recs[i].ReviewedAt = st.ReviewedAt
		}
	}
}

// attachQueues writes `QueueType` on every record carrying a
// match_queue row. Pure function, called once per aggregateAll.
func attachQueues(recs []MatchRecord, queues map[string]db.QueueState) {
	if len(queues) == 0 {
		return
	}
	for i := range recs {
		if st, ok := queues[recs[i].MatchKey]; ok {
			recs[i].QueueType = st.QueueType
		}
	}
}

// attachPlayModes writes `PlayMode` on every record carrying a
// match_play_mode row. Pure-override semantics: PlayMode is set ONLY
// from the aux table — no fallback to data.mode, no inference from
// rank-row presence. The earlier "override → data.mode → rank →
// empty" chain made the "Not set" UI chip unreachable on any match
// the parser had captured (which is every seeded match). New
// matches default to "Not set" until the user toggles, matching
// the user's "unless I know otherwise it should be unset" intent.
//
// Pure function, called once per aggregateAll.
func attachPlayModes(recs []MatchRecord, overrides map[string]db.PlayModeState) {
	if len(overrides) == 0 {
		return
	}
	for i := range recs {
		if st, ok := overrides[recs[i].MatchKey]; ok {
			recs[i].PlayMode = st.PlayMode
		}
	}
}

// attachAmbiguity flags every MatchRecord whose match_key starts with
// "ambiguous-" and attaches its candidate match list. The candidates
// map is keyed by the filename embedded in the sentinel — every
// MatchRecord that adopted the same sentinel (via the timestamp-window
// pass) shares one candidates entry.
//
// Each AmbiguousAttribution is enriched with a representative source
// file (the candidate match's earliest SourceFile + its dir id) so
// the Unknown-tab picker can render a thumbnail beside each
// candidate. Built from a one-pass O(N) index over recs.
func attachAmbiguity(recs []MatchRecord, candidates map[string][]db.AmbiguousCandidate) {
	// Index recs by match_key for O(1) candidate lookups. Built only
	// when at least one ambiguous record exists — most aggregate
	// runs skip this entirely.
	var byKey map[string]*MatchRecord
	ensureIndex := func() {
		if byKey != nil {
			return
		}
		byKey = make(map[string]*MatchRecord, len(recs))
		for i := range recs {
			byKey[recs[i].MatchKey] = &recs[i]
		}
	}

	for i := range recs {
		mk, err := match.ParseMatchKey(recs[i].MatchKey)
		if err != nil || !mk.IsAmbiguous() {
			continue
		}
		recs[i].Ambiguous = true
		cs, ok := candidates[mk.Filename()]
		if !ok {
			continue
		}
		ensureIndex()
		recs[i].Candidates = make([]AmbiguousAttribution, 0, len(cs))
		for _, c := range cs {
			attr := AmbiguousAttribution{
				MatchKey:        c.MatchKey,
				DistanceSeconds: c.DistanceSeconds,
			}
			if cand, ok := byKey[c.MatchKey]; ok && len(cand.SourceFiles) > 0 {
				attr.RepresentativeSourceFile = cand.SourceFiles[0]
				if cand.SourceDirIDs != nil {
					attr.RepresentativeDirID = cand.SourceDirIDs[cand.SourceFiles[0]]
				}
			}
			recs[i].Candidates = append(recs[i].Candidates, attr)
		}
	}
}

// attachHidden flips `Hidden` to true on every record whose match_key
// is in the soft-delete set. Pure function, called once per aggregateAll.
func attachHidden(recs []MatchRecord, hidden map[string]bool) {
	if len(hidden) == 0 {
		return
	}
	for i := range recs {
		if hidden[recs[i].MatchKey] {
			recs[i].Hidden = true
		}
	}
}

// attachAnnotations grafts user-curated leaver/note records onto the
// aggregated MatchRecord slice. Match-key lookup; missing → nil
// (unannotated). Pure function, exported only via aggregateAll +
// the streaming path in app_wails.go / app_server.go's emit.
func attachAnnotations(recs []MatchRecord, annos map[string]db.Annotation) {
	if len(annos) == 0 {
		return
	}
	for i := range recs {
		if a, ok := annos[recs[i].MatchKey]; ok {
			recs[i].Annotation = &MatchAnnotation{
				Leaver:      a.Leaver,
				Note:        a.Note,
				ReplayCode:  a.ReplayCode,
				Members:     a.Members,
				Tags:        a.Tags,
				AnnotatedAt: a.AnnotatedAt,
			}
		}
	}
}
