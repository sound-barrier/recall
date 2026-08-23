package dbtest

import (
	"cmp"
	"errors"
	"slices"

	"recall/pkg/db"
)

// The self-review family, in memory. Every rule the SQL store enforces
// through a constraint is spelled out here — the composite FK that takes a
// note with its membership, the review-must-exist and match-must-be-a-member
// checks, first-save instants that survive a re-save — because the contract
// suite holds both implementations to one behavior.

func (f *Fake) CreateSelfReview(r db.SelfReview) (db.SelfReview, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if r.ReviewID == "" {
		r.ReviewID = db.NewCoachNoteID()
	}
	if f.SelfReviews == nil {
		f.SelfReviews = map[string]db.SelfReview{}
	}
	if _, dup := f.SelfReviews[r.ReviewID]; dup {
		return db.SelfReview{}, errors.New("create self review: review_id already exists")
	}
	now := nowRFC3339()
	if r.CreatedAt == "" {
		r.CreatedAt = now
	}
	if r.UpdatedAt == "" {
		r.UpdatedAt = now
	}
	r.MatchKeys = distinctKeys(r.MatchKeys)
	r.Notes = map[string]db.SelfReviewNote{}
	f.SelfReviews[r.ReviewID] = r
	return f.cloneSelfReview(r), nil
}

func (f *Fake) UpdateSelfReview(reviewID, title string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	r, ok := f.SelfReviews[reviewID]
	if !ok {
		return db.ErrSelfReviewUnknown
	}
	r.Title, r.UpdatedAt = title, nowRFC3339()
	f.SelfReviews[reviewID] = r
	return nil
}

func (f *Fake) FinishSelfReview(reviewID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	r, ok := f.SelfReviews[reviewID]
	if !ok {
		return db.ErrSelfReviewUnknown
	}
	now := nowRFC3339()
	if r.FinishedAt == "" {
		r.FinishedAt = now
	}
	r.UpdatedAt = now
	f.SelfReviews[reviewID] = r
	return nil
}

func (f *Fake) DeleteSelfReview(reviewID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.SelfReviews, reviewID)
	// self_review_focus_items.review_id is ON DELETE CASCADE and the pragma
	// is on, so the SQL store loses these with the parent. A fake that kept
	// them would let a test pass here and fail there, which is what makes a
	// corner-cutting fake worse than no fake.
	delete(f.SelfReviewFocusItems, reviewID)
	return nil
}

func (f *Fake) SetSelfReviewMatches(reviewID string, matchKeys []string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	r, ok := f.SelfReviews[reviewID]
	if !ok {
		return db.ErrSelfReviewUnknown
	}
	// A note on a match that leaves the set goes with it (the composite FK);
	// one on a match that stays is kept. Repeats collapse to their first
	// position, as the SQL store's PK + upsert make them.
	matchKeys = distinctKeys(matchKeys)
	for k := range r.Notes {
		if !slices.Contains(matchKeys, k) {
			delete(r.Notes, k)
		}
	}
	r.MatchKeys = slices.Clone(matchKeys)
	r.UpdatedAt = nowRFC3339()
	f.SelfReviews[reviewID] = r
	return nil
}

func (f *Fake) LoadSelfReviews() ([]db.SelfReview, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]db.SelfReview, 0, len(f.SelfReviews))
	for _, r := range f.SelfReviews {
		out = append(out, f.cloneSelfReview(r))
	}
	// Newest first, review_id as the tie-break — the SQL ORDER BY.
	slices.SortStableFunc(out, func(a, b db.SelfReview) int {
		if c := cmp.Compare(b.CreatedAt, a.CreatedAt); c != 0 {
			return c
		}
		return cmp.Compare(a.ReviewID, b.ReviewID)
	})
	return out, nil
}

func (f *Fake) LoadSelfReview(reviewID string) (db.SelfReview, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	r, ok := f.SelfReviews[reviewID]
	if !ok {
		return db.SelfReview{}, false, nil
	}
	return f.cloneSelfReview(r), true, nil
}

func (f *Fake) UpsertSelfReviewNote(n db.SelfReviewNote) (db.SelfReviewNote, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	r, ok := f.SelfReviews[n.ReviewID]
	if !ok {
		return db.SelfReviewNote{}, db.ErrSelfReviewUnknown
	}
	if !slices.Contains(r.MatchKeys, n.MatchKey) {
		return db.SelfReviewNote{}, db.ErrSelfReviewMatchUnknown
	}
	now := nowRFC3339()
	// A write carrying its own instant is a replay and leaves the sitting's
	// stamp alone; a live write is work on the sitting.
	live := n.UpdatedAt == ""
	if n.CreatedAt == "" {
		n.CreatedAt = now
	}
	if n.UpdatedAt == "" {
		n.UpdatedAt = now
	}
	n.FocusTags, n.ExtraTags = distinctSortedTags(n.FocusTags), distinctSortedTags(n.ExtraTags)
	if prev, exists := r.Notes[n.MatchKey]; exists {
		// created_at and the moments belong to the first save.
		n.CreatedAt = prev.CreatedAt
		n.Moments = prev.Moments
	} else {
		n.Moments = nil
	}
	if r.Notes == nil {
		r.Notes = map[string]db.SelfReviewNote{}
	}
	r.Notes[n.MatchKey] = n
	if live {
		r.UpdatedAt = now
	}
	f.SelfReviews[n.ReviewID] = r
	return cloneSelfReviewNote(n), nil
}

func (f *Fake) DeleteSelfReviewNote(ref db.SelfReviewNoteRef) error {
	reviewID, matchKey := ref.ReviewID, ref.MatchKey
	f.mu.Lock()
	defer f.mu.Unlock()
	r, ok := f.SelfReviews[reviewID]
	if !ok {
		return nil
	}
	if _, had := r.Notes[matchKey]; had {
		delete(r.Notes, matchKey)
		// A delete is always live work on the sitting.
		r.UpdatedAt = nowRFC3339()
		f.SelfReviews[reviewID] = r
	}
	return nil
}

func (f *Fake) UpsertSelfReviewMoment(ref db.SelfReviewNoteRef, m db.SelfReviewMoment) (db.SelfReviewMoment, error) {
	reviewID, matchKey := ref.ReviewID, ref.MatchKey
	f.mu.Lock()
	defer f.mu.Unlock()
	if m.MomentID == "" {
		return db.SelfReviewMoment{}, errors.New("upsert self review moment: moment_id is required")
	}
	r, ok := f.SelfReviews[reviewID]
	if !ok {
		return db.SelfReviewMoment{}, db.ErrSelfReviewUnknown
	}
	if !slices.Contains(r.MatchKeys, matchKey) {
		return db.SelfReviewMoment{}, db.ErrSelfReviewMatchUnknown
	}
	now := nowRFC3339()
	live := m.UpdatedAt == ""
	n := noteForMoment(r, reviewID, matchKey, now)
	var placed db.SelfReviewMoment
	n.Moments, placed = placeMoment(n.Moments, stampMoment(m, now))
	r.Notes[matchKey] = n
	if live {
		r.UpdatedAt = now
	}
	f.SelfReviews[reviewID] = r
	return placed, nil
}

// noteForMoment returns the note a moment hangs on, opening a reviewed_only
// one when there is none — the moment IS a review of the match — in the same
// step, as the SQL store does in one transaction.
func noteForMoment(r db.SelfReview, reviewID, matchKey, now string) db.SelfReviewNote {
	if r.Notes == nil {
		r.Notes = map[string]db.SelfReviewNote{}
	}
	if n, ok := r.Notes[matchKey]; ok {
		return n
	}
	return db.SelfReviewNote{ReviewID: reviewID, MatchKey: matchKey, Kind: "reviewed_only", CreatedAt: now, UpdatedAt: now}
}

// stampMoment fills the instants a live write leaves empty.
func stampMoment(m db.SelfReviewMoment, now string) db.SelfReviewMoment {
	if m.CreatedAt == "" {
		m.CreatedAt = now
	}
	if m.UpdatedAt == "" {
		m.UpdatedAt = now
	}
	return m
}

// placeMoment replaces the moment with the same id (keeping its first
// instant) or appends a new one, and returns the list and the moment as
// stored.
func placeMoment(moments []db.SelfReviewMoment, m db.SelfReviewMoment) ([]db.SelfReviewMoment, db.SelfReviewMoment) {
	for i, prev := range moments {
		if prev.MomentID == m.MomentID {
			m.CreatedAt = prev.CreatedAt
			moments[i] = m
			return moments, m
		}
	}
	return append(moments, m), m
}

func (f *Fake) DeleteSelfReviewMoment(ref db.SelfReviewMomentRef) error {
	reviewID, matchKey, momentID := ref.ReviewID, ref.MatchKey, ref.MomentID
	f.mu.Lock()
	defer f.mu.Unlock()
	r, ok := f.SelfReviews[reviewID]
	if !ok {
		return nil
	}
	n, ok := r.Notes[matchKey]
	if !ok {
		return nil
	}
	before := len(n.Moments)
	n.Moments = slices.DeleteFunc(n.Moments, func(x db.SelfReviewMoment) bool { return x.MomentID == momentID })
	r.Notes[matchKey] = n
	if len(n.Moments) != before {
		r.UpdatedAt = nowRFC3339()
		f.SelfReviews[reviewID] = r
	}
	return nil
}

func (f *Fake) LoadSelfReviewNotes() (map[string][]db.SelfReviewNoteOnMatch, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := map[string][]db.SelfReviewNoteOnMatch{}
	for _, r := range f.SelfReviews {
		for _, n := range r.Notes {
			out[n.MatchKey] = append(out[n.MatchKey], db.SelfReviewNoteOnMatch{
				SelfReviewNote:   cloneSelfReviewNote(n),
				ReviewTitle:      r.Title,
				ReviewCreatedAt:  r.CreatedAt,
				ReviewFinishedAt: r.FinishedAt,
			})
		}
	}
	for k := range out {
		db.SortSelfReviewNotesBySitting(out[k])
	}
	return out, nil
}

// dropSelfReviewMembershipForKey mirrors HardDeleteMatch: the match leaves
// every review it was in, its note goes with the membership, the review stays.
func (f *Fake) dropSelfReviewMembershipForKey(matchKey string) {
	for id, r := range f.SelfReviews {
		if !slices.Contains(r.MatchKeys, matchKey) {
			continue
		}
		r.MatchKeys = slices.DeleteFunc(slices.Clone(r.MatchKeys), func(k string) bool { return k == matchKey })
		delete(r.Notes, matchKey)
		f.SelfReviews[id] = r
	}
}

// cloneSelfReview hands the caller its own copy: the Fake's rows are shared
// state, and a test that mutates a returned slice must not reach back in.
// cloneSelfReview mirrors the SQL loader: the row plus everything that
// hangs off it, including the focus list, which lives in its own table.
// Callers hold f.mu.
func (f *Fake) cloneSelfReview(r db.SelfReview) db.SelfReview {
	r.MatchKeys = slices.Clone(r.MatchKeys)
	notes := make(map[string]db.SelfReviewNote, len(r.Notes))
	for k, n := range r.Notes {
		notes[k] = cloneSelfReviewNote(n)
	}
	r.Notes = notes
	r.FocusItems = slices.Clone(f.SelfReviewFocusItems[r.ReviewID])
	return r
}

func cloneSelfReviewNote(n db.SelfReviewNote) db.SelfReviewNote {
	n.FocusTags = slices.Clone(n.FocusTags)
	n.ExtraTags = slices.Clone(n.ExtraTags)
	// Moments read back in the SQL store's order — by clock, then sort_order.
	moments := slices.Clone(n.Moments)
	slices.SortStableFunc(moments, func(a, b db.SelfReviewMoment) int {
		if c := cmp.Compare(a.MatchClock, b.MatchClock); c != 0 {
			return c
		}
		return cmp.Compare(a.SortOrder, b.SortOrder)
	})
	n.Moments = moments
	return n
}

// distinctSortedTags mirrors the SQL store's tag normalization: empties
// dropped, duplicates collapsed, sorted, nil when nothing remains.
func distinctSortedTags(values []string) []string {
	var out []string
	for _, v := range values {
		if v != "" && !slices.Contains(out, v) {
			out = append(out, v)
		}
	}
	slices.Sort(out)
	return out
}

// distinctKeys mirrors the SQL store's: repeats collapse to their first
// position.
func distinctKeys(keys []string) []string {
	out := make([]string, 0, len(keys))
	seen := make(map[string]bool, len(keys))
	for _, k := range keys {
		if seen[k] {
			continue
		}
		seen[k] = true
		out = append(out, k)
	}
	return out
}
