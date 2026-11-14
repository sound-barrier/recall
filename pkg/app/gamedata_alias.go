package app

import (
	"recall/pkg/applog"
	"recall/pkg/gamedata"
)

// The game-data update pipeline lives in pkg/gamedata (carved out of
// this package per the decomposition plan). These aliases keep the
// wire types, the pkg/cmd sentinel mappings, and the Wails binding
// surface byte-identical — the shell only wires the install root in.

type (
	GameDataStatus   = gamedata.Status
	RosterDiff       = gamedata.RosterDiff
	DataUpdateResult = gamedata.DataUpdateResult
	ChecksumError    = gamedata.ChecksumError
	DataManifest     = gamedata.DataManifest
	ManifestFile     = gamedata.ManifestFile
)

var (
	ErrDataUpdateChecksum        = gamedata.ErrDataUpdateChecksum
	ErrDataUpdateMalformed       = gamedata.ErrDataUpdateMalformed
	ErrDataUpdateIO              = gamedata.ErrDataUpdateIO
	ErrDataUpdateMainFetchFailed = gamedata.ErrDataUpdateMainFetchFailed
)

// ApplyGameDataUpdate downloads + verifies + applies the live game
// data from the Pages-published main channel. Wails-bound; the HTTP
// twin is POST /api/v1/system/data-update.
func (a *App) ApplyGameDataUpdate() (DataUpdateResult, error) {
	return gamedata.Apply(appBaseDir())
}

// recoverGameData resolves an apply a previous process died in the middle
// of, before anything reads the data directory. Not fatal: the embedded
// dataset still loads, and the next apply replaces whatever is there.
func recoverGameData() {
	outcome, err := gamedata.Recover(appBaseDir())
	logger := applog.Subsystem("apply_data_update")
	if err != nil {
		logger.Error("interrupted data update could not be finished", "outcome", outcome, "err", err)
		return
	}
	if outcome != gamedata.RecoveredNothing {
		logger.Info("interrupted data update resolved", "outcome", outcome)
	}
}
