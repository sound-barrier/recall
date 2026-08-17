package matchedit

import (
	"errors"

	"recall/pkg/db"
)

// validQueueTypes enumerates the two queue formats Overwatch matches
// can land in:
//   - "role" — 5v5 role queue (locked 1-2-2 composition)
//   - "open" — 6v6 open queue (any composition)
//
// The empty string is the third logical state ("queue not set") and
// goes through ClearQueue, not SetQueue.
var validQueueTypes = map[string]bool{"role": true, "open": true}

// ErrInvalidQueueType is returned by SetQueue when the queue_type
// value isn't 'role' or 'open'. HTTP handlers map this to 400 —
// user-input error, not a server fault.
var ErrInvalidQueueType = errors.New("invalid queue_type: must be 'role' or 'open'")

// IsValidQueueType reports whether queueType is one of the two stored
// values. Exported for the manual-match form, where the field is
// optional and only a SUPPLIED value has to be valid.
func IsValidQueueType(queueType string) bool { return validQueueTypes[queueType] }

// SetQueue tags a match as having been played in role queue (5v5) or
// open queue (6v6). Idempotent — repeated identical calls succeed;
// calling with a different value overwrites.
//
// Use ClearQueue to revert to the "queue not set" state.
func SetQueue(s db.Store, matchKey, queueType string) error {
	if matchKey == "" {
		return ErrMatchKeyRequired
	}
	if !validQueueTypes[queueType] {
		return ErrInvalidQueueType
	}
	if err := AssertMatchExists(s, matchKey); err != nil {
		return err
	}
	return s.SetMatchQueue(matchKey, queueType)
}

// ClearQueue removes the queue-type tag. Idempotent — clearing an
// unset match is a no-op.
func ClearQueue(s db.Store, matchKey string) error {
	if matchKey == "" {
		return ErrMatchKeyRequired
	}
	return s.ClearMatchQueue(matchKey)
}

// BulkSetQueue applies the same queue_type to every key in the slice
// in one transaction. queueType="" clears the rows (bulk clear).
// Validates the value before reaching SQL so an invalid input never
// starts a partial-write. The slice is allowed to be empty — returns
// nil without touching the store.
func BulkSetQueue(s db.Store, matchKeys []string, queueType string) error {
	if queueType != "" && !validQueueTypes[queueType] {
		return ErrInvalidQueueType
	}
	// Only the set direction creates rows; a bulk clear on stale keys
	// removes nothing and stays idempotent.
	if queueType != "" {
		if err := assertMatchesExist(s, matchKeys); err != nil {
			return err
		}
	}
	return s.BulkSetMatchQueue(matchKeys, queueType)
}
