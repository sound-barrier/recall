package db_test

import (
	"path/filepath"
	"strings"
	"testing"

	"recall/pkg/db"
)

// Store read methods must wrap driver errors with operation context
// (ledger section 10): a bare "sql: database is closed" from one of
// aggregateAll's seven loads is undiagnosable in a field log because
// nothing says WHICH load failed. The contract: every error carries a
// "load <what>:" prefix naming the operation.
func TestSQLStore_LoadErrors_CarryOperationContext(t *testing.T) {
	store, err := db.NewSQLStore(filepath.Join(t.TempDir(), "recall.db"))
	if err != nil {
		t.Fatalf("NewSQLStore: %v", err)
	}
	// Closing the store forces every subsequent query to fail with a
	// bare driver error — exactly what the wrap must contextualize.
	if err := store.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	calls := []struct {
		context string
		call    func() error
	}{
		{"load screenshots", func() error { _, err := store.LoadAll(); return err }},
		{"load annotations", func() error { _, err := store.LoadAnnotations(); return err }},
		{"load hidden keys", func() error { _, err := store.LoadHiddenKeys(); return err }},
		{"load reviews", func() error { _, err := store.LoadReviews(); return err }},
		{"load match queues", func() error { _, err := store.LoadMatchQueues(); return err }},
		{"load match play modes", func() error { _, err := store.LoadMatchPlayModes(); return err }},
		{"load user match data", func() error { _, err := store.LoadAllUserMatchData(); return err }},
	}
	for _, c := range calls {
		err := c.call()
		if err == nil {
			t.Errorf("%s: expected an error from a closed store", c.context)
			continue
		}
		if !strings.Contains(err.Error(), c.context+":") {
			t.Errorf("error lacks operation context %q: got %q", c.context, err.Error())
		}
	}
}
