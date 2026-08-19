package bundle

import (
	"fmt"
	"sort"

	"recall/pkg/db"
)

// bundleUserLayer is the include-filtered user-layer state riding in a
// v2 bundle.
type bundleUserLayer struct {
	userData    []db.UserMatchData
	annotations []db.Annotation
	reviews     map[string]db.ReviewState
	queues      map[string]db.QueueState
	playModes   map[string]db.PlayModeState
	hidden      []string
	pinned      []string
	coachNotes  []db.MatchCoachNote
	moments     []db.MatchMoment
	selfReviews []db.SelfReview
}

// loadBundleUserLayer gathers every user-layer surface for the included
// match keys. Slices sort by match_key for deterministic bundle bytes.
func loadBundleUserLayer(store db.Store, include map[string]struct{}) (bundleUserLayer, error) {
	layer, err := loadBundleSidecars(store, include)
	if err != nil {
		return bundleUserLayer{}, err
	}
	coachNotes, err := store.LoadMatchCoachNotes()
	if err != nil {
		return bundleUserLayer{}, fmt.Errorf("export bundle: load coach notes: %w", err)
	}
	layer.coachNotes = sortedIncludedCoachNotes(coachNotes, include)
	moments, err := store.LoadMatchMoments()
	if err != nil {
		return bundleUserLayer{}, fmt.Errorf("export bundle: load match moments: %w", err)
	}
	layer.moments = sortedIncludedMoments(moments, include)
	selfReviews, err := store.LoadSelfReviews()
	if err != nil {
		return bundleUserLayer{}, fmt.Errorf("export bundle: load self reviews: %w", err)
	}
	layer.selfReviews = includedSelfReviews(selfReviews, include)
	return layer, nil
}

// includedSelfReviews narrows each sitting to the included keys — members
// and notes alike — and drops a sitting with no included member. The
// sitting travels under its own UUID, so a re-import updates in place.
func includedSelfReviews(reviews []db.SelfReview, include map[string]struct{}) []db.SelfReview {
	var out []db.SelfReview
	for _, r := range reviews {
		narrowed := narrowSelfReview(r, func(k string) bool { _, ok := include[k]; return ok })
		if len(narrowed.MatchKeys) == 0 {
			continue
		}
		out = append(out, narrowed)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ReviewID < out[j].ReviewID })
	return out
}

// narrowSelfReview keeps the members (in order) and notes that pass keep.
func narrowSelfReview(r db.SelfReview, keep func(string) bool) db.SelfReview {
	out := r
	out.MatchKeys = nil
	out.Notes = map[string]db.SelfReviewNote{}
	for _, k := range r.MatchKeys {
		if keep(k) {
			out.MatchKeys = append(out.MatchKeys, k)
		}
	}
	for k, n := range r.Notes {
		if keep(k) {
			out.Notes[k] = n
		}
	}
	return out
}

// sortedIncludedMoments collects the player's own timestamped moments for the
// included keys. A list per key, like the coach notes above, so it needs its
// own collector rather than the one-value-per-key helpers.
func sortedIncludedMoments(byKey map[string][]db.MatchMoment, include map[string]struct{}) []db.MatchMoment {
	var out []db.MatchMoment
	for k, moments := range byKey {
		if _, ok := include[k]; ok {
			out = append(out, moments...)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].MatchKey != out[j].MatchKey {
			return out[i].MatchKey < out[j].MatchKey
		}
		return out[i].MomentID < out[j].MomentID
	})
	return out
}

// loadBundleSidecars gathers the per-key user surfaces (everything but the
// coach layer, which is a list per key rather than one value per key).
func loadBundleSidecars(store db.Store, include map[string]struct{}) (bundleUserLayer, error) {
	userData, err := store.LoadAllUserMatchData()
	if err != nil {
		return bundleUserLayer{}, fmt.Errorf("export bundle: load user data: %w", err)
	}
	annotations, err := store.LoadAnnotations()
	if err != nil {
		return bundleUserLayer{}, fmt.Errorf("export bundle: load annotations: %w", err)
	}
	reviews, err := store.LoadReviews()
	if err != nil {
		return bundleUserLayer{}, fmt.Errorf("export bundle: load reviews: %w", err)
	}
	queues, err := store.LoadMatchQueues()
	if err != nil {
		return bundleUserLayer{}, fmt.Errorf("export bundle: load queues: %w", err)
	}
	playModes, err := store.LoadMatchPlayModes()
	if err != nil {
		return bundleUserLayer{}, fmt.Errorf("export bundle: load play modes: %w", err)
	}
	hidden, err := store.LoadHiddenKeys()
	if err != nil {
		return bundleUserLayer{}, fmt.Errorf("export bundle: load hidden keys: %w", err)
	}
	pinned, err := store.LoadPinnedKeys()
	if err != nil {
		return bundleUserLayer{}, fmt.Errorf("export bundle: load pinned keys: %w", err)
	}
	return bundleUserLayer{
		userData:    sortedIncludedValues(userData, include, func(d db.UserMatchData) string { return d.MatchKey }),
		annotations: sortedIncludedValues(annotations, include, func(a db.Annotation) string { return a.MatchKey }),
		reviews:     filterIncludedMap(reviews, include),
		queues:      filterIncludedMap(queues, include),
		playModes:   filterIncludedMap(playModes, include),
		hidden:      sortedIncludedKeys(hidden, include),
		pinned:      sortedIncludedKeys(pinned, include),
	}, nil
}

// sortedIncludedValues collects the values of a match_key-keyed map whose
// key is in the include set, sorted by keyOf for deterministic bundle
// bytes. Returns nil when nothing survives (omitted from the JSON).
func sortedIncludedValues[V any](m map[string]V, include map[string]struct{}, keyOf func(V) string) []V {
	var out []V
	for k, v := range m {
		if _, ok := include[k]; ok {
			out = append(out, v)
		}
	}
	sort.Slice(out, func(i, j int) bool { return keyOf(out[i]) < keyOf(out[j]) })
	return out
}

// filterIncludedMap keeps the entries whose match_key is in the include
// set. Returns nil when nothing survives (omitted from the JSON).
func filterIncludedMap[V any](m map[string]V, include map[string]struct{}) map[string]V {
	var out map[string]V
	for k, v := range m {
		if _, ok := include[k]; !ok {
			continue
		}
		if out == nil {
			out = map[string]V{}
		}
		out[k] = v
	}
	return out
}

// sortedIncludedKeys collects the keys of a match_key-keyed map that are
// in the include set, sorted. Returns nil when nothing survives.
func sortedIncludedKeys[V any](m map[string]V, include map[string]struct{}) []string {
	var out []string
	for k := range m {
		if _, ok := include[k]; ok {
			out = append(out, k)
		}
	}
	sort.Strings(out)
	return out
}

// sortedIncludedCoachNotes flattens the per-key coach blocks whose key is in
// the include set into one list ordered by (match_key, note_id) — the store
// hands each key's blocks in accepted_at order, which differs machine to
// machine, and the bundle bytes must not. Returns nil when nothing survives.
func sortedIncludedCoachNotes(byKey map[string][]db.MatchCoachNote, include map[string]struct{}) []db.MatchCoachNote {
	var out []db.MatchCoachNote
	for k, notes := range byKey {
		if _, ok := include[k]; ok {
			out = append(out, notes...)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].MatchKey != out[j].MatchKey {
			return out[i].MatchKey < out[j].MatchKey
		}
		return out[i].NoteID < out[j].NoteID
	})
	return out
}
