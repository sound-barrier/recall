package app

import (
	"recall/pkg/match"
	"recall/pkg/matchedit"
)

// The user-override surface: the inline edit set that shadows the parsed OCR
// rows, and the hand-entered matches that have no OCR rows at all. Every value
// rule — the result enum, the numeric bounds api/openapi.yaml documents, the
// map/hero/tier roster checks, the match_key minting — lives in pkg/matchedit.
// What stays here is what the leaf cannot see: design rule 1's coaching-session
// write gate, the read-only-profile refusal, and the re-read + broadcast that
// makes an edit show up in every connected client.

// UpdateMatchData replaces the user override set for a match (inline edits send
// the full current set; a per-field revert is the same call with that field
// omitted). The override layer is kept separate from the parsed OCR rows, so a
// later ResetMatchData restores the original. Emits the re-aggregated record.
func (a *App) UpdateMatchData(matchKey string, input match.UserMatchDataInput) error {
	if err := a.assertNoCoachSession(); err != nil {
		return err
	}
	if err := matchedit.SetUserData(a.store, matchKey, input); err != nil {
		return err
	}
	a.emitMatchByKey(matchKey)
	return nil
}

// ResetMatchData clears the user override set for a match — reverting an edited
// OCR match to pure OCR. (Deleting a hand-entered match is HardDeleteMatch, which
// also clears its queue / play-mode aux rows.) Idempotent.
func (a *App) ResetMatchData(matchKey string) error {
	if err := a.assertNoCoachSession(); err != nil {
		return err
	}
	if err := matchedit.ResetUserData(a.store, matchKey); err != nil {
		return err
	}
	a.emitMatchByKey(matchKey)
	return nil
}

// CreateManualMatch hand-enters a match for users without OCR. The leaf mints
// the match_key, refuses a collision, and writes the override plus aux rows;
// the shell re-reads the key to aggregate the record the API returns. The
// right-side detail-panel choosers then work unchanged — they key on match_key.
func (a *App) CreateManualMatch(input match.ManualMatchInput) (match.Record, error) {
	if err := a.assertNoCoachSession(); err != nil {
		return match.Record{}, err
	}
	if err := a.assertActiveMutable(); err != nil {
		return match.Record{}, err
	}
	key, err := matchedit.CreateManual(a.store, input)
	if err != nil {
		return match.Record{}, err
	}
	rec, err := a.GetMatchByKey(key)
	if err != nil {
		return match.Record{}, err
	}
	a.emitMatchUpdated(rec)
	return rec, nil
}

// emitMatchByKey re-aggregates the single match and broadcasts it so connected
// clients refresh after an edit / reset. A no-op when the key no longer resolves
// (e.g. a manual match whose override row was just cleared).
func (a *App) emitMatchByKey(key string) {
	if rec, err := a.GetMatchByKey(key); err == nil {
		a.emitMatchUpdated(rec)
	}
}
