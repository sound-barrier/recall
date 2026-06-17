package db_test

import (
	"strconv"
	"sync"
	"testing"

	"recall/pkg/db"
)

// TestSQLStore_ConcurrentReadDuringWrite guards the busy_timeout fix. On a file
// database, a read (LoadAll, behind GET /matches) that races a write (a parse
// folding screenshots in) hits SQLITE_BUSY. SQLite's default busy_timeout is 0
// — fail immediately — so the loser surfaced as "database is locked" → a 500.
// A busy_timeout set on every pooled connection makes the loser WAIT for the
// lock instead. With heavy read/write contention this fails (errors) on the
// old config and passes clean with the timeout.
func TestSQLStore_ConcurrentReadDuringWrite(t *testing.T) {
	s, err := db.NewSQLStore(t.TempDir() + "/concurrent.db")
	if err != nil {
		t.Fatalf("NewSQLStore: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })

	const workers, iters = 16, 60
	var wg sync.WaitGroup
	errs := make(chan error, workers*iters)
	for w := range workers {
		wg.Go(func() {
			for i := range iters {
				if w%2 == 0 { // half write…
					if err := s.SetMatchQueue("match-"+strconv.Itoa(w*iters+i), "role"); err != nil {
						errs <- err
					}
				} else if _, err := s.LoadAll(); err != nil { // …half read
					errs <- err
				}
			}
		})
	}
	wg.Wait()
	close(errs)

	for err := range errs {
		t.Errorf("concurrent op errored (SQLITE_BUSY without busy_timeout): %v", err)
	}
}
