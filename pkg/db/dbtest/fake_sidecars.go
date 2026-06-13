package dbtest

import (
	"time"

	"recall/pkg/db"
)

func (f *Fake) SetAnnotation(a db.Annotation) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Annotations == nil {
		f.Annotations = map[string]db.Annotation{}
	}
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
	for k, v := range f.Annotations {
		out[k] = v
	}
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
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Reviews == nil {
		f.Reviews = map[string]db.ReviewState{}
	}
	// Preserve a previously-seeded ReviewedAt if the test set one;
	// otherwise stamp "now" so dossier coverage that fans out across
	// the Fake observes a non-empty timestamp.
	prev := f.Reviews[matchKey]
	if prev.ReviewedAt == "" {
		prev.ReviewedAt = time.Now().UTC().Format(time.RFC3339)
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
	for k, v := range f.Reviews {
		out[k] = v
	}
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
	for k, v := range f.Queues {
		out[k] = v
	}
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
	for k, v := range f.PlayModes {
		out[k] = v
	}
	return out, nil
}

func (f *Fake) LoadHiddenKeys() (map[string]bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make(map[string]bool, len(f.Hidden))
	for k, v := range f.Hidden {
		out[k] = v
	}
	return out, nil
}
