package dbtest

import (
	"fmt"
	"maps"
	"slices"
	"time"

	"recall/pkg/db"
)

func (f *Fake) SetAnnotation(a db.Annotation) error { return f.setAnnotation(a, "") }

// SetAnnotationAt mirrors SQLStore's restore path: the row keeps the instant
// it carries, and an empty one falls back to the Fake's clock.
func (f *Fake) SetAnnotationAt(a db.Annotation) error { return f.setAnnotation(a, a.AnnotatedAt) }

func (f *Fake) setAnnotation(a db.Annotation, annotatedAt string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Annotations == nil {
		f.Annotations = map[string]db.Annotation{}
	}
	a.AnnotatedAt = suppliedInstantOrNow(annotatedAt)
	f.Annotations[a.MatchKey] = a
	return nil
}

func (f *Fake) DeleteAnnotation(matchKey string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.Annotations, matchKey)
	return nil
}

func (f *Fake) LoadAnnotations() (map[string]db.Annotation, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make(map[string]db.Annotation, len(f.Annotations))
	maps.Copy(out, f.Annotations)
	return out, nil
}

func (f *Fake) HideMatch(matchKey string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.HideCalls = append(f.HideCalls, matchKey)
	if f.Hidden == nil {
		f.Hidden = map[string]bool{}
	}
	f.Hidden[matchKey] = true
	return nil
}

func (f *Fake) UnhideMatch(matchKey string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.UnhideCalls = append(f.UnhideCalls, matchKey)
	delete(f.Hidden, matchKey)
	return nil
}

func (f *Fake) SetReview(matchKey, reviewedBy string) error {
	return f.SetReviewAt(matchKey, reviewedBy, "")
}

// SetReviewAt mirrors SQLStore's restore path: a supplied instant is written
// as given, an empty one falls back to the Fake's clock.
func (f *Fake) SetReviewAt(matchKey, reviewedBy, reviewedAt string) error {
	// schema.sql pins the vocabulary with a CHECK constraint, so SQLStore
	// rejects anything else. Mirror it: a Fake that accepts a reviewer the
	// real store refuses lets every test built on it reach a state
	// production cannot, and makes the defensive code written for that
	// state look live.
	if reviewedBy != "self" && reviewedBy != "coach" {
		return fmt.Errorf("dbtest: reviewed_by %q violates the self/coach vocabulary", reviewedBy)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Reviews == nil {
		f.Reviews = map[string]db.ReviewState{}
	}
	// Exactly SQLStore's rule: a supplied instant is written as given (the
	// restore path), an empty one is stamped now — including over a stamp
	// already there, because re-marking a match reviewed is a live edit.
	// This deliberately does NOT preserve a previously-seeded value: a Fake
	// that froze reviewed_at let tests reach a state the real store cannot
	// produce. Seed a specific instant with SetReviewAt.
	prev := f.Reviews[matchKey]
	if reviewedAt != "" {
		prev.ReviewedAt = reviewedAt
	} else {
		prev.ReviewedAt = nowRFC3339()
	}
	prev.ReviewedBy = reviewedBy
	f.Reviews[matchKey] = prev
	return nil
}

func (f *Fake) ClearReview(matchKey string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.Reviews, matchKey)
	return nil
}

func (f *Fake) LoadReviews() (map[string]db.ReviewState, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make(map[string]db.ReviewState, len(f.Reviews))
	maps.Copy(out, f.Reviews)
	return out, nil
}

func (f *Fake) SetMatchQueue(matchKey, queueType string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Queues == nil {
		f.Queues = map[string]db.QueueState{}
	}
	prev := f.Queues[matchKey]
	if prev.OverriddenAt == "" {
		prev.OverriddenAt = time.Now().UTC().Format(time.RFC3339)
	}
	prev.QueueType = queueType
	f.Queues[matchKey] = prev
	return nil
}

func (f *Fake) ClearMatchQueue(matchKey string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.Queues, matchKey)
	return nil
}

func (f *Fake) BulkSetMatchQueue(matchKeys []string, queueType string) error {
	for _, k := range matchKeys {
		if queueType == "" {
			if err := f.ClearMatchQueue(k); err != nil {
				return err
			}
			continue
		}
		if err := f.SetMatchQueue(k, queueType); err != nil {
			return err
		}
	}
	return nil
}

func (f *Fake) LoadMatchQueues() (map[string]db.QueueState, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make(map[string]db.QueueState, len(f.Queues))
	maps.Copy(out, f.Queues)
	return out, nil
}

func (f *Fake) SetMatchPlayMode(matchKey, playMode string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.PlayModes == nil {
		f.PlayModes = map[string]db.PlayModeState{}
	}
	prev := f.PlayModes[matchKey]
	if prev.OverriddenAt == "" {
		prev.OverriddenAt = time.Now().UTC().Format(time.RFC3339)
	}
	prev.PlayMode = playMode
	f.PlayModes[matchKey] = prev
	return nil
}

func (f *Fake) ClearMatchPlayMode(matchKey string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.PlayModes, matchKey)
	return nil
}

func (f *Fake) BulkSetMatchPlayMode(matchKeys []string, playMode string) error {
	for _, k := range matchKeys {
		if playMode == "" {
			if err := f.ClearMatchPlayMode(k); err != nil {
				return err
			}
			continue
		}
		if err := f.SetMatchPlayMode(k, playMode); err != nil {
			return err
		}
	}
	return nil
}

func (f *Fake) LoadMatchPlayModes() (map[string]db.PlayModeState, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make(map[string]db.PlayModeState, len(f.PlayModes))
	maps.Copy(out, f.PlayModes)
	return out, nil
}

func (f *Fake) PinMatch(matchKey string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Pinned == nil {
		f.Pinned = map[string]bool{}
	}
	f.Pinned[matchKey] = true
	return nil
}

func (f *Fake) UnpinMatch(matchKey string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.Pinned, matchKey)
	return nil
}

func (f *Fake) LoadPinnedKeys() (map[string]bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make(map[string]bool, len(f.Pinned))
	maps.Copy(out, f.Pinned)
	return out, nil
}

func (f *Fake) LoadHiddenKeys() (map[string]bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make(map[string]bool, len(f.Hidden))
	maps.Copy(out, f.Hidden)
	return out, nil
}

// ── The player's own timestamped moments ──────────────────────────────────

func (f *Fake) UpsertMatchMoment(m db.MatchMoment) (db.MatchMoment, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.MatchMoments == nil {
		f.MatchMoments = map[string][]db.MatchMoment{}
	}
	// The id is the client's to mint, so the Fake enforces the same scope the
	// SQL WHERE does: an id already used on another match is refused rather
	// than silently rewriting that match's observation.
	for key, bucket := range f.MatchMoments {
		if key == m.MatchKey {
			continue
		}
		if slices.ContainsFunc(bucket, func(x db.MatchMoment) bool { return x.MomentID == m.MomentID }) {
			return db.MatchMoment{}, db.ErrMomentMatchMismatch
		}
	}
	now := nowRFC3339()
	m.CreatedAt, m.UpdatedAt = now, now
	bucket := f.MatchMoments[m.MatchKey]
	for i, prev := range bucket {
		if prev.MomentID == m.MomentID {
			m.CreatedAt = prev.CreatedAt
			bucket[i] = m
			return m, nil
		}
	}
	if m.MomentID == "" {
		m.MomentID = db.NewCoachNoteID()
	}
	f.MatchMoments[m.MatchKey] = append(bucket, m)
	return m, nil
}

func (f *Fake) DeleteMatchMoment(matchKey, momentID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.MatchMoments[matchKey] = slices.DeleteFunc(f.MatchMoments[matchKey],
		func(m db.MatchMoment) bool { return m.MomentID == momentID })
	return nil
}

func (f *Fake) LoadMatchMoments() (map[string][]db.MatchMoment, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := map[string][]db.MatchMoment{}
	for key, bucket := range f.MatchMoments {
		if len(bucket) > 0 {
			out[key] = slices.Clone(bucket)
		}
	}
	return out, nil
}
