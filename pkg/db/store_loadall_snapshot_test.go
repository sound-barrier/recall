package db_test

import (
	"fmt"
	"sync"
	"testing"

	"recall/pkg/db"
)

// The fixed screenshot the snapshot-consistency probe resolves over and the
// ambiguous sentinel derived from it.
const (
	snapshotProbeFile     = "pending.png"
	snapshotProbeSentinel = "ambiguous-cGVuZGluZy5wbmc"
)

// LoadAll must be snapshot-consistent. Its bulk selects previously ran as
// independent queries on pooled connections, so a cross-table write landing
// between them was visible half-applied. ResolveAmbiguous is the sharpest
// probe: in ONE transaction it rewrites the parent row's match_key AND
// deletes the filename's candidate rows — a torn LoadAll sees either a
// resolved parent with surviving candidates or a still-sentinel parent
// with none.
func TestSQLStore_LoadAllIsSnapshotConsistent(t *testing.T) {
	s, err := db.NewSQLStore(t.TempDir() + "/snapshot.db")
	if err != nil {
		t.Fatalf("NewSQLStore: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })

	for i := range 40 {
		resolved := fmt.Sprintf("match-2026-01-01T12-00-%02d", i)
		resolveUnderConcurrentLoadAll(t, s, resolved)
		if t.Failed() {
			return
		}
	}
}

// resolveUnderConcurrentLoadAll seeds the sentinel parent + one candidate
// quiescently, then races LoadAll readers against a single ResolveAmbiguous.
func resolveUnderConcurrentLoadAll(t *testing.T, s *db.SQLStore, resolved string) {
	t.Helper()
	const readers = 4
	mustNoErr(t, s.UpsertUnknown(db.UnknownRow{Filename: snapshotProbeFile, MatchKey: snapshotProbeSentinel}))
	mustNoErr(t, s.ApplyAmbiguity(snapshotProbeFile, []db.AmbiguousCandidate{{MatchKey: resolved, DistanceSeconds: 60}}))

	done := make(chan struct{})
	var wg sync.WaitGroup
	for range readers {
		wg.Go(func() {
			watchForTornSnapshot(t, s, done, resolved)
		})
	}
	if ok, err := s.ResolveAmbiguous(snapshotProbeFile, snapshotProbeSentinel, resolved); err != nil || !ok {
		close(done)
		wg.Wait()
		t.Fatalf("ResolveAmbiguous = (%v, %v)", ok, err)
	}
	close(done)
	wg.Wait()
}

// watchForTornSnapshot loads snapshots until done closes, failing on any
// snapshot that is neither fully pre-resolve (sentinel parent + 1 candidate)
// nor fully post-resolve (rewritten parent + 0 candidates).
func watchForTornSnapshot(t *testing.T, s *db.SQLStore, done <-chan struct{}, resolved string) {
	t.Helper()
	for {
		select {
		case <-done:
			return
		default:
		}
		snap, err := s.LoadAll()
		if err != nil {
			t.Errorf("LoadAll: %v", err)
			return
		}
		var parentKey string
		for _, u := range snap.Unknowns {
			if u.Filename == snapshotProbeFile {
				parentKey = u.MatchKey
			}
		}
		cands := len(snap.AmbiguousCandidates[snapshotProbeFile])
		sentinelPending := parentKey == snapshotProbeSentinel && cands == 1
		fullyResolved := parentKey == resolved && cands == 0
		if !sentinelPending && !fullyResolved {
			t.Errorf("torn snapshot: parent=%q candidates=%d (want sentinel+1 or resolved+0)", parentKey, cands)
			return
		}
	}
}
