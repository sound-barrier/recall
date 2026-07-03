package db_test

import (
	"fmt"
	"sync"
	"testing"

	"recall/pkg/db"
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

	const filename = "pending.png"
	const sentinel = "ambiguous-cGVuZGluZy5wbmc"
	const readers = 4

	for i := range 40 {
		resolved := fmt.Sprintf("match-2026-01-01T12-00-%02d", i)
		// Seed quiescently: sentinel parent + one candidate.
		if err := s.UpsertUnknown(db.UnknownRow{Filename: filename, MatchKey: sentinel}); err != nil {
			t.Fatal(err)
		}
		if err := s.ApplyAmbiguity(filename, []db.AmbiguousCandidate{{MatchKey: resolved, DistanceSeconds: 60}}); err != nil {
			t.Fatal(err)
		}

		done := make(chan struct{})
		var wg sync.WaitGroup
		for range readers {
			wg.Go(func() {
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
						if u.Filename == filename {
							parentKey = u.MatchKey
						}
					}
					cands := len(snap.AmbiguousCandidates[filename])
					sentinelPending := parentKey == sentinel && cands == 1
					fullyResolved := parentKey == resolved && cands == 0
					if !sentinelPending && !fullyResolved {
						t.Errorf("torn snapshot: parent=%q candidates=%d (want sentinel+1 or resolved+0)", parentKey, cands)
						return
					}
				}
			})
		}
		if ok, err := s.ResolveAmbiguous(filename, sentinel, resolved); err != nil || !ok {
			close(done)
			wg.Wait()
			t.Fatalf("ResolveAmbiguous = (%v, %v)", ok, err)
		}
		close(done)
		wg.Wait()
		if t.Failed() {
			return
		}
	}
}
