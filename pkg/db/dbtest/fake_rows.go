package dbtest

import (
	"slices"

	"recall/pkg/db"
)

// The Fake mirrors SQLStore semantics across the five parent screenshot
// tables, which live here as five differently-typed slices. Go generics
// cannot reach struct fields through a type constraint, so this file
// centralizes the field access ONCE (type-switch getters/setter) and
// builds the generic sweep vocabulary the Fake's methods share — before
// it, every cross-table operation repeated the same loop five times.

type parentRow interface {
	db.SummaryRow | db.TeamsRow | db.PersonalRow | db.RankRow | db.UnknownRow
}

func rowMatchKey[T parentRow](r T) string {
	switch v := any(r).(type) {
	case db.SummaryRow:
		return v.MatchKey
	case db.TeamsRow:
		return v.MatchKey
	case db.PersonalRow:
		return v.MatchKey
	case db.RankRow:
		return v.MatchKey
	case db.UnknownRow:
		return v.MatchKey
	}
	return ""
}

func rowFilename[T parentRow](r T) string {
	switch v := any(r).(type) {
	case db.SummaryRow:
		return v.Filename
	case db.TeamsRow:
		return v.Filename
	case db.PersonalRow:
		return v.Filename
	case db.RankRow:
		return v.Filename
	case db.UnknownRow:
		return v.Filename
	}
	return ""
}

func setRowMatchKey[T parentRow](r *T, key string) {
	switch v := any(r).(type) {
	case *db.SummaryRow:
		v.MatchKey = key
	case *db.TeamsRow:
		v.MatchKey = key
	case *db.PersonalRow:
		v.MatchKey = key
	case *db.RankRow:
		v.MatchKey = key
	case *db.UnknownRow:
		v.MatchKey = key
	}
}

// collectFilenamesByKey adds the filename of every row keyed to matchKey
// into the accumulator set.
func collectFilenamesByKey[T parentRow](rows []T, matchKey string, into map[string]bool) {
	for _, r := range rows {
		if rowMatchKey(r) == matchKey {
			into[rowFilename(r)] = true
		}
	}
}

// dropByMatchKey filters rows in place, keeping those not keyed to
// matchKey.
func dropByMatchKey[T parentRow](rows []T, matchKey string) []T {
	kept := rows[:0]
	for _, r := range rows {
		if rowMatchKey(r) != matchKey {
			kept = append(kept, r)
		}
	}
	return kept
}

func hasMatchKey[T parentRow](rows []T, key string) bool {
	for _, r := range rows {
		if rowMatchKey(r) == key {
			return true
		}
	}
	return false
}

// rekeyRows repoints every row keyed to `from` at `to`, returning how
// many rows moved.
func rekeyRows[T parentRow](rows []T, from, to string) int {
	n := 0
	for i := range rows {
		if rowMatchKey(rows[i]) == from {
			setRowMatchKey(&rows[i], to)
			n++
		}
	}
	return n
}

// deleteByFilename drops every row carrying filename, reporting each
// dropped row's match key to collect.
func deleteByFilename[T parentRow](rows []T, filename string, collect func(key string)) []T {
	return slices.DeleteFunc(rows, func(r T) bool {
		if rowFilename(r) == filename {
			collect(rowMatchKey(r))
			return true
		}
		return false
	})
}
