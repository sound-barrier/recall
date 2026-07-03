package app

import (
	"errors"
	"fmt"

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
