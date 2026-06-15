package aggregate

import (
	"cmp"
	"slices"

	"recall/pkg/db"
	"recall/pkg/match"
	"recall/pkg/parser"
)

// AttachReviews writes `ReviewedBy` + `ReviewedAt` on every record
// carrying a review-status row. Pure function, called once per
// aggregateAll.
func AttachReviews(recs []match.MatchRecord, reviews map[string]db.ReviewState) {
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

// AttachQueues writes `QueueType` on every record carrying a
// match_queue row. Pure function, called once per aggregateAll.
func AttachQueues(recs []match.MatchRecord, queues map[string]db.QueueState) {
	if len(queues) == 0 {
		return
	}
	for i := range recs {
		if st, ok := queues[recs[i].MatchKey]; ok {
			recs[i].QueueType = st.QueueType
		}
	}
}

// AttachPlayModes writes `PlayMode` on every record carrying a
// match_play_mode row. Pure-override semantics: PlayMode is set ONLY
// from the aux table — no fallback to data.mode, no inference from
// rank-row presence. The earlier "override → data.mode → rank →
// empty" chain made the "Not set" UI chip unreachable on any match
// the parser had captured (which is every seeded match). New
// matches default to "Not set" until the user toggles, matching
// the user's "unless I know otherwise it should be unset" intent.
//
// Pure function, called once per aggregateAll.
func AttachPlayModes(recs []match.MatchRecord, overrides map[string]db.PlayModeState) {
	if len(overrides) == 0 {
		return
	}
	for i := range recs {
		if st, ok := overrides[recs[i].MatchKey]; ok {
			recs[i].PlayMode = st.PlayMode
		}
	}
}

// AttachAmbiguity flags every match.MatchRecord whose match_key starts with
// "ambiguous-" and attaches its candidate match list. The candidates
// map is keyed by the filename embedded in the sentinel — every
// match.MatchRecord that adopted the same sentinel (via the timestamp-window
// pass) shares one candidates entry.
//
// Each match.AmbiguousAttribution is enriched with a representative source
// file (the candidate match's earliest SourceFile + its dir id) so
// the Unknown-tab picker can render a thumbnail beside each
// candidate. Built from a one-pass O(N) index over recs.
func AttachAmbiguity(recs []match.MatchRecord, candidates map[string][]db.AmbiguousCandidate) {
	// Index recs by match_key for O(1) candidate lookups. Built only
	// when at least one ambiguous record exists — most aggregate
	// runs skip this entirely.
	var byKey map[string]*match.MatchRecord
	ensureIndex := func() {
		if byKey != nil {
			return
		}
		byKey = make(map[string]*match.MatchRecord, len(recs))
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
		recs[i].Candidates = make([]match.AmbiguousAttribution, 0, len(cs))
		for _, c := range cs {
			attr := match.AmbiguousAttribution{
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

// AttachHidden flips `Hidden` to true on every record whose match_key
// is in the soft-delete set. Pure function, called once per aggregateAll.
func AttachHidden(recs []match.MatchRecord, hidden map[string]bool) {
	if len(hidden) == 0 {
		return
	}
	for i := range recs {
		if hidden[recs[i].MatchKey] {
			recs[i].Hidden = true
		}
	}
}

// AttachAnnotations grafts user-curated leaver/note records onto the
// aggregated match.MatchRecord slice. Match-key lookup; missing → nil
// (unannotated). Pure function, exported only via aggregateAll +
// the streaming path in app_wails.go / app_server.go's emit.
func AttachAnnotations(recs []match.MatchRecord, annos map[string]db.Annotation) {
	if len(annos) == 0 {
		return
	}
	for i := range recs {
		if a, ok := annos[recs[i].MatchKey]; ok {
			recs[i].Annotation = &match.MatchAnnotation{
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

// AttachUserData overlays the per-match user override layer onto the aggregated
// records: non-nil scalars win over the OCR Data, the heroes-played list is
// replaced when the user supplied one, stat-cell and SR overrides overlay, and
// Role / GameMode re-derive from any edited hero / map. A screenshot-backed
// record becomes SourceOCREdited (with EditedFields listing the overridden
// paths); a synthesized shell stays SourceManual. Pure function, called once
// per aggregateAll, AFTER SynthesizeManualMatches.
func AttachUserData(recs []match.MatchRecord, userData map[string]db.UserMatchData) {
	if len(userData) == 0 {
		return
	}
	for i := range recs {
		if ud, ok := userData[recs[i].MatchKey]; ok {
			applyUserData(&recs[i], ud)
		}
	}
}

func applyUserData(rec *match.MatchRecord, ud db.UserMatchData) {
	manual := len(rec.SourceFiles) == 0
	var edited []string
	mark := func(path string) {
		if !manual {
			edited = append(edited, path)
		}
	}

	d := &rec.Data
	applyScalarOverrides(d, ud, mark)
	if len(ud.Heroes) > 0 {
		d.HeroesPlayed = userHeroesToPlays(ud.Heroes)
		mark("data.heroes_played")
	}
	for _, st := range ud.HeroStats {
		overlayHeroStat(d, st.Hero, st.StatKey, st.Value)
		mark("data.heroes_played." + st.Hero + ".stats." + st.StatKey)
	}
	if len(ud.SR) > 0 {
		d.SR = userSRToParser(ud.SR)
		mark("data.sr")
	}
	if len(ud.Modifiers) > 0 {
		d.Modifiers = ud.Modifiers
		mark("data.modifiers")
	}

	// Re-derive AFTER overriding so an edited hero / map drives Role / GameMode
	// (these are never stored; see .claude/rules/database.md).
	if ud.Hero != nil && d.Hero != "" {
		d.Role = parser.HeroRole(d.Hero)
	}
	if ud.Map != nil && d.Map != "" {
		d.GameMode = parser.MapGameMode(d.Map)
	}

	if manual {
		rec.Source = match.SourceManual
		if rec.ParsedAt == "" {
			rec.ParsedAt = ud.UpdatedAt
		}
		return
	}
	rec.Source = match.SourceOCREdited
	rec.EditedFields = edited
}

// applyScalarOverrides copies every non-nil override scalar onto d (table-driven
// so the field list stays flat instead of 18 branches). Overriding map / hero
// also clears the stale raw-OCR text so the "Unknown map / hero" hint retires.
func applyScalarOverrides(d *parser.MatchResult, ud db.UserMatchData, mark func(string)) {
	for _, s := range []struct {
		val  *string
		dst  *string
		path string
	}{
		{ud.Map, &d.Map, "data.map"},
		{ud.Hero, &d.Hero, "data.hero"},
		{ud.Result, &d.Result, "data.result"},
		{ud.FinalScore, &d.FinalScore, "data.final_score"},
		{ud.Date, &d.Date, "data.date"},
		{ud.FinishedAt, &d.FinishedAt, "data.finished_at"},
		{ud.GameLength, &d.GameLength, "data.game_length"},
		{ud.Rank, &d.Rank, "data.rank"},
	} {
		if s.val != nil {
			*s.dst = *s.val
			mark(s.path)
		}
	}
	for _, n := range []struct {
		val  *int
		dst  *int
		path string
	}{
		{ud.Eliminations, &d.Eliminations, "data.eliminations"},
		{ud.Assists, &d.Assists, "data.assists"},
		{ud.Deaths, &d.Deaths, "data.deaths"},
		{ud.Damage, &d.Damage, "data.damage"},
		{ud.Healing, &d.Healing, "data.healing"},
		{ud.Mitigation, &d.Mitigation, "data.mitigation"},
		{ud.Level, &d.Level, "data.level"},
		{ud.RankProgress, &d.RankProgress, "data.rank_progress"},
		{ud.ChangePercent, &d.ChangePercent, "data.change_percent"},
	} {
		if n.val != nil {
			*n.dst = *n.val
			mark(n.path)
		}
	}
	if ud.Map != nil {
		d.MapRaw = ""
	}
	if ud.Hero != nil {
		d.HeroRaw = ""
	}
}

// userHeroesToPlays converts the user's heroes-played LIST override into the
// parser shape, ordered by position so position 0 (primary) leads.
func userHeroesToPlays(heroes []db.UserMatchHero) []parser.HeroPlay {
	sorted := slices.Clone(heroes)
	slices.SortStableFunc(sorted, func(a, b db.UserMatchHero) int {
		return cmp.Compare(a.Position, b.Position)
	})
	out := make([]parser.HeroPlay, 0, len(sorted))
	for _, h := range sorted {
		p := parser.HeroPlay{Hero: h.Hero}
		if h.PercentPlayed != nil {
			p.PercentPlayed = *h.PercentPlayed
		}
		if h.PlayTime != nil {
			p.PlayTime = *h.PlayTime
		}
		out = append(out, p)
	}
	return out
}

// overlayHeroStat sets one stat cell on the matching heroes-played entry,
// appending a minimal entry if the user overrode a stat for a hero the OCR list
// doesn't carry. Independent of the list override — a stat edit never implies a
// roster replacement.
func overlayHeroStat(d *parser.MatchResult, hero, statKey string, val int) {
	for i := range d.HeroesPlayed {
		if d.HeroesPlayed[i].Hero == hero {
			if d.HeroesPlayed[i].Stats == nil {
				d.HeroesPlayed[i].Stats = map[string]int{}
			}
			d.HeroesPlayed[i].Stats[statKey] = val
			return
		}
	}
	d.HeroesPlayed = append(d.HeroesPlayed, parser.HeroPlay{
		Hero:  hero,
		Stats: map[string]int{statKey: val},
	})
}

func userSRToParser(sr []db.HeroSR) []parser.HeroSR {
	out := make([]parser.HeroSR, len(sr))
	for i, s := range sr {
		out[i] = parser.HeroSR{Hero: s.Hero, SR: s.SR, Change: s.Change}
	}
	return out
}
