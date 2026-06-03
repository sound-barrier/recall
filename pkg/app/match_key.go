package app

import (
	"errors"
	"strings"
)

// MatchKey is the typed form of the stringly-typed `match_key`
// identity used across the codebase. A match key is one of three
// shapes:
//
//   - `match-<YYYY-MM-DDTHH-MM-SS>`  → KindTracked     (real match)
//   - `unmatched-<filename>`         → KindUnmatched   (timestamp absent)
//   - `ambiguous-<filename>`         → KindAmbiguous   (pending resolution)
//
// The legacy form used `:` instead of `-` between the kind prefix and
// the body; a one-time migration in pkg/db.SQLStore rewrote on-disk
// rows so the wire format is now stable on the dash form.
//
// This type is OPT-IN at internal call sites today — consumers can
// keep treating match_key as a bare string for back-compat. New code
// that needs to BRANCH on the kind (e.g. "is this an ambiguous
// row?") should parse via ParseMatchKey and switch on .Kind rather
// than `strings.HasPrefix`. The eventual goal is to migrate every
// startsWith / HasPrefix site to this type — tracked in
// TECHNICAL_DEBT.md.

type MatchKeyKind int

const (
	KindInvalid MatchKeyKind = iota
	KindTracked
	KindUnmatched
	KindAmbiguous
)

type MatchKey struct {
	Kind MatchKeyKind
	// Raw is the original input string, preserved so String() round-
	// trips. Cheaper than re-formatting from Kind + Body, and lets
	// the type carry forward shape oddities (case, trailing dots)
	// rather than swallowing them.
	Raw string
	// Body is the portion of the key past the kind prefix. For
	// KindTracked this is the ISO-extended timestamp (with `-`
	// separators); for the other kinds it's the original filename.
	Body string
}

// ErrInvalidMatchKey is returned by ParseMatchKey for any input that
// doesn't carry one of the three known prefixes. The caller can
// errors.Is against this sentinel for graceful handling.
var ErrInvalidMatchKey = errors.New("invalid match key")

// ParseMatchKey returns the typed form of `s`, or ErrInvalidMatchKey
// if `s` doesn't carry one of the three known prefixes.
func ParseMatchKey(s string) (MatchKey, error) {
	switch {
	case strings.HasPrefix(s, "match-"):
		return MatchKey{Kind: KindTracked, Raw: s, Body: s[len("match-"):]}, nil
	case strings.HasPrefix(s, "unmatched-"):
		return MatchKey{Kind: KindUnmatched, Raw: s, Body: s[len("unmatched-"):]}, nil
	case strings.HasPrefix(s, "ambiguous-"):
		return MatchKey{Kind: KindAmbiguous, Raw: s, Body: s[len("ambiguous-"):]}, nil
	}
	return MatchKey{}, ErrInvalidMatchKey
}

// String returns the wire form of the key. Round-trips through
// ParseMatchKey unchanged.
func (k MatchKey) String() string { return k.Raw }

// IsAmbiguous is a thin convenience over Kind == KindAmbiguous —
// the most common branch at every existing call site. Keeps the
// .Kind enum private at the consumer.
func (k MatchKey) IsAmbiguous() bool { return k.Kind == KindAmbiguous }

// IsUnmatched mirrors IsAmbiguous for unmatched keys.
func (k MatchKey) IsUnmatched() bool { return k.Kind == KindUnmatched }

// IsTracked mirrors IsAmbiguous for normal tracked keys.
func (k MatchKey) IsTracked() bool { return k.Kind == KindTracked }
