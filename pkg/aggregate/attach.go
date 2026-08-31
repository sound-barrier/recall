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
func AttachReviews(recs []match.Record, reviews map[string]db.ReviewState) {
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
func AttachQueues(recs []match.Record, queues map[string]db.QueueState) {
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
func AttachPlayModes(recs []match.Record, overrides map[string]db.PlayModeState) {
	if len(overrides) == 0 {
		return
	}
	for i := range recs {
		if st, ok := overrides[recs[i].MatchKey]; ok {
			recs[i].PlayMode = st.PlayMode
		}
	}
}

// AttachAmbiguity flags every match.Record whose match_key starts with
// "ambiguous-" and attaches its candidate match list. The candidates
// map is keyed by the filename embedded in the sentinel — every
// match.Record that adopted the same sentinel (via the timestamp-window
// pass) shares one candidates entry.
//
// Each match.AmbiguousAttribution is enriched with a representative source
// file (the candidate match's earliest SourceFile + its dir id) so
// the Unknown-tab picker can render a thumbnail beside each
// candidate. Built from a one-pass O(N) index over recs.
func AttachAmbiguity(recs []match.Record, candidates map[string][]db.AmbiguousCandidate) {
	// The by-key index is built only when at least one ambiguous record
	// has candidates — most aggregate runs skip it entirely.
	var byKey map[string]*match.Record
	for i := range recs {
		mk, err := match.ParseKey(recs[i].MatchKey)
		if err != nil || !mk.IsAmbiguous() {
			continue
		}
		recs[i].Ambiguous = true
		cs, ok := candidates[mk.Filename()]
		if !ok {
			continue
		}
		if byKey == nil {
			byKey = indexRecordsByKey(recs)
		}
		recs[i].Candidates = ambiguousAttributions(cs, byKey)
	}
}

// indexRecordsByKey maps match_key → record pointer for O(1) candidate
// lookups.
func indexRecordsByKey(recs []match.Record) map[string]*match.Record {
	byKey := make(map[string]*match.Record, len(recs))
	for i := range recs {
		byKey[recs[i].MatchKey] = &recs[i]
	}
	return byKey
}

// ambiguousAttributions converts stored candidates into their domain
// shape, enriching each with a representative source file (+ dir id)
// from the indexed records so the Unknown-tab picker can render a
// thumbnail beside it.
func ambiguousAttributions(cs []db.AmbiguousCandidate, byKey map[string]*match.Record) []match.AmbiguousAttribution {
	out := make([]match.AmbiguousAttribution, 0, len(cs))
	for _, c := range cs {
		attr := match.AmbiguousAttribution{
			MatchKey:        c.MatchKey,
			DistanceSeconds: c.DistanceSeconds,
			Reason:          c.Reason,
		}
		if cand, ok := byKey[c.MatchKey]; ok && len(cand.SourceFiles) > 0 {
			attr.RepresentativeSourceFile = cand.SourceFiles[0]
			if cand.SourceDirIDs != nil {
				attr.RepresentativeDirID = cand.SourceDirIDs[cand.SourceFiles[0]]
			}
		}
		out = append(out, attr)
	}
	return out
}

// AttachPinned flips `Pinned` on every record in the starred set.
// Pure function, called once per aggregateAll.
// AttachDuplicateLinks names, on each match, the ones it was judged
// separate from. The map arrives symmetric — the store reads each stored
// row from both ends — so a card and its twin both carry the link.
func AttachDuplicateLinks(recs []match.Record, links map[string][]string) {
	if len(links) == 0 {
		return
	}
	for i := range recs {
		if of, ok := links[recs[i].MatchKey]; ok {
			recs[i].DuplicateOf = of
		}
	}
}

func AttachPinned(recs []match.Record, pinned map[string]bool) {
	if len(pinned) == 0 {
		return
	}
	for i := range recs {
		if pinned[recs[i].MatchKey] {
			recs[i].Pinned = true
		}
	}
}

// AttachHidden flips `Hidden` to true on every record whose match_key
// is in the soft-delete set. Pure function, called once per aggregateAll.
func AttachHidden(recs []match.Record, hidden map[string]bool) {
	if len(hidden) == 0 {
		return
	}
	for i := range recs {
		if hidden[recs[i].MatchKey] {
			recs[i].Hidden = true
		}
	}
}

// AttachReferenceGapAcks flips `ReferenceGapAcknowledged` on every
// record whose match_key is in the acknowledged set — the AttachHidden
// shape for the Unknown tab's gap warnings.
func AttachReferenceGapAcks(recs []match.Record, acked map[string]bool) {
	if len(acked) == 0 {
		return
	}
	for i := range recs {
		if acked[recs[i].MatchKey] {
			recs[i].ReferenceGapAcknowledged = true
		}
	}
}

// sidesOrEmpty guarantees a non-nil slice. `leavers` / `throwers` are required
// on the MatchAnnotation schema, and Go marshals a nil slice as `null` — which
// violates `type: array` and trips schemathesis's response_schema_conformance.
// Same rule as every other array on the wire (see .claude/rules/api-design.md).
func sidesOrEmpty(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

// annotationFromRow converts a stored annotation into its domain shape. Two
// call sites attach annotations — the bulk aggregate and the single-record
// sidecar path — and a field added to only one of them goes missing with no
// compile error, so both go through here.
func annotationFromRow(a db.Annotation) *match.Annotation {
	return &match.Annotation{
		Leavers:         sidesOrEmpty(a.Leavers),
		Throwers:        sidesOrEmpty(a.Throwers),
		Note:            a.Note,
		ReplayCode:      a.ReplayCode,
		Members:         a.Members,
		Tags:            a.Tags,
		ExclusionReason: a.ExclusionReason,
		AnnotatedAt:     a.AnnotatedAt,
	}
}

// AttachAnnotations grafts user-curated disruption/note records onto the
// aggregated match.Record slice. Match-key lookup; missing → nil
// (unannotated). Pure function, exported only via aggregateAll +
// the streaming path in app_wails.go / app_server.go's emit.
func AttachAnnotations(recs []match.Record, annos map[string]db.Annotation) {
	if len(annos) == 0 {
		return
	}
	for i := range recs {
		if a, ok := annos[recs[i].MatchKey]; ok {
			recs[i].Annotation = annotationFromRow(a)
		}
	}
}

// coachNoteFromRow converts one accepted coach block into its domain shape.
// Both attach sites — the bulk aggregate and the single-record sidecar
// path — go through here so the list read and the single-match read
// cannot disagree on a field. Tag slices are carried as the store hands
// them over (nil stays nil, empty stays empty).
func coachNoteFromRow(n db.MatchCoachNote) match.CoachNote {
	return match.CoachNote{
		ID:          n.ID,
		NoteID:      n.NoteID,
		CoachName:   n.CoachName,
		SessionDate: n.SessionDate,
		Text:        n.Text,
		MatchClock:  n.MatchClock,
		FocusTags:   n.FocusTags,
		ExtraTags:   n.ExtraTags,
		Moments:     coachMomentsFromRows(n.Moments),
		AcceptedAt:  n.AcceptedAt,
	}
}

// coachMomentsFromRows converts the block's moments. The store already loads
// them in reading order, so this keeps it; nil for a note with none, which
// omitempty then keeps off the wire entirely.
func coachMomentsFromRows(rows []db.MatchCoachNoteMoment) []match.CoachNoteMoment {
	if len(rows) == 0 {
		return nil
	}
	out := make([]match.CoachNoteMoment, 0, len(rows))
	for _, m := range rows {
		out = append(out, match.CoachNoteMoment{
			MomentID:   m.MomentID,
			MatchClock: m.MatchClock,
			Text:       m.Text,
			FocusTag:   m.FocusTag,
		})
	}
	return out
}

// coachNotesFromRows converts a store-ordered block list wholesale. The
// store already orders by (accepted_at, id), so the order is kept, not
// re-sorted; an empty list yields nil so CoachNotes stays absent on the
// wire.
func coachNotesFromRows(rows []db.MatchCoachNote) []match.CoachNote {
	if len(rows) == 0 {
		return nil
	}
	out := make([]match.CoachNote, 0, len(rows))
	for _, n := range rows {
		out = append(out, coachNoteFromRow(n))
	}
	return out
}

// AttachCoachNotes grafts the coach-received layer — every accepted coach
// block, in store order — onto the aggregated match.Record slice.
// Match-key lookup; missing → nil (no coach has written about it). Pure
// function, called once per aggregateAll.
func AttachCoachNotes(recs []match.Record, notes map[string][]db.MatchCoachNote) {
	if len(notes) == 0 {
		return
	}
	for i := range recs {
		if rows, ok := notes[recs[i].MatchKey]; ok {
			recs[i].CoachNotes = coachNotesFromRows(rows)
		}
	}
}

// AttachSelfReviewNotes grafts the player's own review sittings' blocks —
// every note they wrote about the match in a saved self review, oldest
// sitting first — onto the records. Match-key lookup; missing → nil.
func AttachSelfReviewNotes(recs []match.Record, notes map[string][]db.SelfReviewNoteOnMatch) {
	if len(notes) == 0 {
		return
	}
	for i := range recs {
		if rows, ok := notes[recs[i].MatchKey]; ok {
			recs[i].SelfReviewNotes = selfReviewNotesFromRows(rows)
		}
	}
}

// selfReviewNotesFromRows converts a match's self-review blocks wholesale,
// keeping the store's order; nil for none so the field stays off the wire.
func selfReviewNotesFromRows(rows []db.SelfReviewNoteOnMatch) []match.SelfReviewNote {
	if len(rows) == 0 {
		return nil
	}
	out := make([]match.SelfReviewNote, 0, len(rows))
	for _, n := range rows {
		out = append(out, selfReviewNoteFromRow(n))
	}
	return out
}

func selfReviewNoteFromRow(n db.SelfReviewNoteOnMatch) match.SelfReviewNote {
	return match.SelfReviewNote{
		ReviewID:         n.ReviewID,
		ReviewTitle:      n.ReviewTitle,
		ReviewCreatedAt:  n.ReviewCreatedAt,
		ReviewFinishedAt: n.ReviewFinishedAt,
		Kind:             n.Kind,
		Text:             n.Text,
		MatchClock:       n.MatchClock,
		FocusTags:        n.FocusTags,
		ExtraTags:        n.ExtraTags,
		Moments:          selfReviewMomentsFromRows(n.Moments),
		UpdatedAt:        n.UpdatedAt,
	}
}

// selfReviewMomentsFromRows converts a self-review note's moments; nil for
// none, like the coach block's.
func selfReviewMomentsFromRows(rows []db.SelfReviewMoment) []match.CoachNoteMoment {
	if len(rows) == 0 {
		return nil
	}
	out := make([]match.CoachNoteMoment, 0, len(rows))
	for _, m := range rows {
		out = append(out, match.CoachNoteMoment{
			MomentID:   m.MomentID,
			MatchClock: m.MatchClock,
			Text:       m.Text,
			FocusTag:   m.FocusTag,
		})
	}
	return out
}

// AttachMatchMoments grafts the PLAYER's own timestamped moments onto the
// records. Distinct from the coach layer above: these are the player's words
// about their own match, and the store already loads them in reading order.
func AttachMatchMoments(recs []match.Record, moments map[string][]db.MatchMoment) {
	if len(moments) == 0 {
		return
	}
	for i := range recs {
		rows, ok := moments[recs[i].MatchKey]
		if !ok || len(rows) == 0 {
			continue
		}
		recs[i].Moments = MatchMomentsFromRows(rows)
	}
}

// MatchMomentsFromRows converts the player's stored moments to the wire shape.
// Exported because the single-key path in aggregate.go must produce byte-identical
// output — a field added to only one converter diverges the list read from the
// single-match read with no compile error, which is exactly how the coach layer
// grew the parity test above it.
func MatchMomentsFromRows(rows []db.MatchMoment) []match.CoachNoteMoment {
	out := make([]match.CoachNoteMoment, 0, len(rows))
	for _, m := range rows {
		out = append(out, match.CoachNoteMoment{
			MomentID:   m.MomentID,
			MatchClock: m.MatchClock,
			Text:       m.Text,
			FocusTag:   m.FocusTag,
		})
	}
	return out
}

// AttachUserData overlays the per-match user override layer onto the aggregated
// records: non-nil scalars win over the OCR Data, the heroes-played list is
// replaced when the user supplied one, stat-cell and SR overrides overlay, and
// Role / GameMode re-derive from any edited hero / map. A screenshot-backed
// record becomes SourceOCREdited (with EditedFields listing the overridden
// paths); a synthesized shell stays SourceManual. Pure function, called once
// per aggregateAll, AFTER SynthesizeManualMatches.
func AttachUserData(recs []match.Record, userData map[string]db.UserMatchData) {
	if len(userData) == 0 {
		return
	}
	for i := range recs {
		if ud, ok := userData[recs[i].MatchKey]; ok {
			applyUserData(&recs[i], ud)
		}
	}
}

func applyUserData(rec *match.Record, ud db.UserMatchData) {
	manual := len(rec.SourceFiles) == 0
	var edited []string
	mark := func(path string) {
		if !manual {
			edited = append(edited, path)
		}
	}

	d := &rec.Data
	applyScalarOverrides(d, ud, mark)
	applyCollectionOverrides(d, ud, mark)
	rederiveEditedFields(d, ud)

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

// applyCollectionOverrides overlays the heroes-played list, per-hero stat
// cells, SR entries, and modifiers when the user supplied them.
func applyCollectionOverrides(d *parser.MatchResult, ud db.UserMatchData, mark func(string)) {
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
		// The user replaced the modifier set wholesale, so a surviving
		// "unrecognized" line would contradict the corrected list they are
		// looking at. Same wipe as MapRaw / HeroRaw on their overrides.
		d.ModifiersRaw = ""
	}
}

// rederiveEditedFields recomputes Role / GameMode AFTER overriding so an
// edited hero / map drives them (derived, never stored; see
// .claude/rules/database.md).
//
// The override is re-derived from unconditionally, empty string included:
// the API lets a user clear an override back to "", and by then
// applyScalarOverrides has already wiped the raw OCR text, so a retained
// Role / GameMode would assert a role with no hero (or a mode with no map)
// that the dossier chip and the mode filter would both keep believing.
// HeroRole("") / MapGameMode("") return "", so clearing propagates.
func rederiveEditedFields(d *parser.MatchResult, ud db.UserMatchData) {
	if ud.Hero != nil {
		d.Role = parser.HeroRole(d.Hero)
	}
	if ud.Map != nil {
		d.GameMode = parser.MapGameMode(d.Map)
	}
}

// applyOptionalIntOverrides overlays the two POINTER-valued rank readings.
// They need their own pass because an override REPLACES the pointer rather than
// writing through it — writing through would nil-deref on exactly the matches an
// override is most useful for: the ones whose screenshot never yielded a value.
func applyOptionalIntOverrides(d *parser.MatchResult, ud db.UserMatchData, mark func(string)) {
	for _, n := range []struct {
		val  *int
		dst  **int
		path string
	}{
		{ud.RankProgress, &d.RankProgress, "data.rank_progress"},
		{ud.ChangePercent, &d.ChangePercent, "data.change_percent"},
	} {
		if n.val != nil {
			v := *n.val
			*n.dst = &v
			mark(n.path)
		}
	}
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
		{ud.PlayedAtUTC, &d.PlayedAtUTC, "data.played_at_utc"},
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
	} {
		if n.val != nil {
			*n.dst = *n.val
			mark(n.path)
		}
	}
	applyOptionalIntOverrides(d, ud, mark)
	if ud.Map != nil {
		d.MapRaw = ""
	}
	if ud.Hero != nil {
		d.HeroRaw = ""
	}
	// The percentile was MEASURED against the rank the screenshot showed, so
	// correcting that rank invalidates it — the same reason a map override
	// clears MapRaw above. Leaving it would print "diamond 5 · higher ranked
	// than 57% of players" using a number read off a platinum 2 screen, and
	// the user has no way to see where the 57% came from.
	//
	// Cleared rather than recomputed: there is no published distribution to
	// recompute it from. That absence is exactly why the old Elo population
	// card was deleted, and inventing a replacement here would be worse than
	// showing nothing.
	if ud.Rank != nil || ud.Level != nil {
		d.RankPercentile = nil
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
