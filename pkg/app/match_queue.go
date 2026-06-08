package app

import (
	"errors"
	"fmt"
)

// validQueueTypes enumerates the two queue formats Overwatch matches
// can land in:
//   - "role" — 5v5 role queue (locked 1-2-2 composition)
//   - "open" — 6v6 open queue (any composition)
//
// The empty string is the third logical state ("queue not set") and
// goes through ClearMatchQueue, not SetMatchQueue.
var validQueueTypes = map[string]bool{"role": true, "open": true}

// ErrInvalidQueueType is returned by SetMatchQueue when the
// queue_type value isn't 'role' or 'open'. HTTP handlers map this
// to 400 — user-input error, not a server fault.
var ErrInvalidQueueType = errors.New("invalid queue_type: must be 'role' or 'open'")

// SetMatchQueue tags a match as having been played in role queue
// (5v5) or open queue (6v6). Idempotent — repeated identical calls
// succeed; calling with a different value overwrites.
//
// Use ClearMatchQueue to revert to the "queue not set" state.
func (a *App) SetMatchQueue(matchKey, queueType string) error {
	if matchKey == "" {
		return fmt.Errorf("match_key required")
	}
	if !validQueueTypes[queueType] {
		return ErrInvalidQueueType
	}
	return a.store.SetMatchQueue(matchKey, queueType)
}

// ClearMatchQueue removes the queue-type tag. Idempotent — clearing
// an unset match is a no-op.
func (a *App) ClearMatchQueue(matchKey string) error {
	if matchKey == "" {
		return fmt.Errorf("match_key required")
	}
	return a.store.ClearMatchQueue(matchKey)
}

// BulkSetMatchQueue applies the same queue_type to every key in the
// slice in one transaction. queueType="" clears the rows (bulk
// Clear). Validates the value before reaching SQL so an invalid
// input never starts a partial-write. The slice is allowed to be
// empty — returns nil without touching the store.
func (a *App) BulkSetMatchQueue(matchKeys []string, queueType string) error {
	if queueType != "" && !validQueueTypes[queueType] {
		return ErrInvalidQueueType
	}
	return a.store.BulkSetMatchQueue(matchKeys, queueType)
}
