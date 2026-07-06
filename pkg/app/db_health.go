package app

import (
	"errors"
	"fmt"

	"recall/pkg/applog"
	"recall/pkg/db"
)

// ErrInvalidMaintenanceOp marks a maintenance request whose operation
// isn't one of the supported values. Maps to 400 at the HTTP layer.
var ErrInvalidMaintenanceOp = errors.New("unknown maintenance operation")

// GetDatabaseHealth runs the read-only health report (integrity check
// + size/freelist stats). Safe concurrently with a parse — WAL
// readers don't block the writer.
func (a *App) GetDatabaseHealth() (db.DBHealth, error) {
	return a.store.Health()
}

// RunDatabaseMaintenance executes one maintenance operation and
// returns the refreshed health report so the UI updates in a single
// round-trip. Serialized against the OCR write path exactly like
// RestoreDatabase: VACUUM takes an exclusive lock for its duration,
// and running it mid-parse would stall both.
func (a *App) RunDatabaseMaintenance(operation string) (db.DBHealth, error) {
	if _, claimed := a.claimParse(false); !claimed {
		return db.DBHealth{}, ErrParseInFlight
	}
	defer a.endParse()

	var err error
	switch operation {
	case "optimize":
		err = a.store.Optimize()
	case "vacuum":
		err = a.store.Vacuum()
	default:
		return db.DBHealth{}, fmt.Errorf("%w: %q", ErrInvalidMaintenanceOp, operation)
	}
	if err != nil {
		return db.DBHealth{}, err
	}
	return a.store.Health()
}

// optimizeAfterParse is the auto half of the "Vacuum scheduler"
// backlog item: PRAGMA optimize runs at the end of every parse run
// that changed at least one match. Per-run (rather than an every-N
// counter) because optimize is self-gating — SQLite decides whether
// any ANALYZE work is worthwhile, so a no-op invocation costs
// milliseconds and there is no counter to persist across restarts.
// VACUUM stays manual (the Database health Compact button): an
// unprompted multi-second exclusive lock is worse than a larger file.
// Failures are logged, never surfaced — maintenance must not fail a
// successful parse.
func (a *App) optimizeAfterParse(matchesChanged int) {
	if matchesChanged == 0 {
		return
	}
	if err := a.store.Optimize(); err != nil {
		applog.Subsystem("parse").Error("post-parse optimize failed", "err", err)
		return
	}
	applog.Subsystem("parse").Info("post-parse optimize ran", "matches_changed", matchesChanged)
}
