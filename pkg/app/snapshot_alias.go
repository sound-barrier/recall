package app

import "recall/pkg/snapshot"

// The backup engine's file half — writing, naming, pruning and validating
// snapshots — lives in pkg/snapshot (carved out per the decomposition plan).
// These aliases keep pkg/cmd's sentinel mappings and the auto-backup response
// shape byte-identical; every *App method signature is unchanged.
//
// Each Err* below MUST stay a plain alias. Re-declaring one with errors.New
// would break the handlers' errors.Is match and turn a 400 or 422 into a
// silent 500; wrapping one with fmt.Errorf would keep the match but change the
// problem+json detail the API promises.

// AutoBackupStatus is the GET /api/v1/settings/auto-backup shape.
type AutoBackupStatus = snapshot.Status

var (
	// ErrRestoreInvalid marks a restore payload that isn't a usable Recall
	// database snapshot. Maps to 422.
	ErrRestoreInvalid = snapshot.ErrRestoreInvalid

	// ErrInvalidBackupInterval marks a PUT with an interval outside -1 (off)
	// or 1..365 days. Maps to 400. The leaf spells it ErrInvalidInterval —
	// inside a package named snapshot the "Backup" was stutter; the shell
	// keeps the name pkg/cmd already references.
	ErrInvalidBackupInterval = snapshot.ErrInvalidInterval
)
