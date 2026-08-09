package app

import (
	"slices"
	"time"

	"recall/pkg/db"
	"recall/pkg/parser"
)

// Run-scoped correlation snapshot. The per-file parse loop used to
// re-materialize the ENTIRE store twice per screenshot (a LoadAll before
// correlation and another inside the match-updated diff, plus three
// sidecar loads) — O(files × total rows). Instead, one snapshot loads at
// run start and is patched in-memory after each insert, using the same
// build*Row constructors the store write uses, so later files correlate
// against earlier files' rows exactly as they did with per-file reloads.
//
// Run-scoped by design: a concurrent user edit mid-run (resolving an
// ambiguous match, hiding a row) becomes visible to correlation on the
// NEXT run — the same self-healing lag a re-parse always had.

// upsertRowInSnapshot mirrors the SQL upsert's conflict semantics on a
// snapshot slice: replace-by-filename keeps the existing row's parsed_at
// (the SET clause deliberately omits it), a fresh insert stamps now —
// the RFC3339 shape the driver returns on read.
func upsertRowInSnapshot[T any](
	rows []T,
	row T,
	now string,
	filenameOf func(T) string,
	parsedAtOf func(T) string,
	setParsedAt func(*T, string),
) []T {
	for i := range rows {
		if filenameOf(rows[i]) == filenameOf(row) {
			setParsedAt(&row, parsedAtOf(rows[i]))
			rows[i] = row
			return rows
		}
	}
	setParsedAt(&row, now)
	return append(rows, row)
}

// applyToSnapshot mirrors insertParsed's store write onto the carried
// snapshot. all_heroes records only a skip-list filename — no match row
// to mirror.
func (st *parseRunState) applyToSnapshot(filename, key, t string, r *parser.MatchResult) {
	// Mirror the store's sibling wipe first: a reclassified file must
	// vanish from the old type's slice, or every match-updated event and
	// every later file's correlation in this run folds the purged row
	// (first-non-empty prefers it — it has the older parsed_at). Skipped
	// for all_heroes, matching insertParsed: a data-less registry entry
	// never evicts a typed row.
	if t != "all_heroes" {
		st.dropSiblingRowsFromSnapshot(filename, t)
	}
	now := time.Now().UTC().Format(time.RFC3339)
	switch t {
	case "summary":
		st.snap.Summaries = upsertRowInSnapshot(st.snap.Summaries,
			buildSummaryRow(filename, key, st.dirID, r), now,
			func(x db.SummaryRow) string { return x.Filename },
			func(x db.SummaryRow) string { return x.ParsedAt },
			func(x *db.SummaryRow, ts string) { x.ParsedAt = ts })
	case "teams":
		st.snap.Teams = upsertRowInSnapshot(st.snap.Teams,
			buildTeamsRow(filename, key, st.dirID, r), now,
			func(x db.TeamsRow) string { return x.Filename },
			func(x db.TeamsRow) string { return x.ParsedAt },
			func(x *db.TeamsRow, ts string) { x.ParsedAt = ts })
	case "personal":
		st.snap.Personals = upsertRowInSnapshot(st.snap.Personals,
			buildPersonalRow(filename, key, st.dirID, r), now,
			func(x db.PersonalRow) string { return x.Filename },
			func(x db.PersonalRow) string { return x.ParsedAt },
			func(x *db.PersonalRow, ts string) { x.ParsedAt = ts })
	case "rank":
		st.snap.Ranks = upsertRowInSnapshot(st.snap.Ranks,
			buildRankRow(filename, key, st.dirID, r), now,
			func(x db.RankRow) string { return x.Filename },
			func(x db.RankRow) string { return x.ParsedAt },
			func(x *db.RankRow, ts string) { x.ParsedAt = ts })
	case "all_heroes":
	default: // unknown
		st.snap.Unknowns = upsertRowInSnapshot(st.snap.Unknowns,
			buildUnknownRow(filename, key, st.dirID), now,
			func(x db.UnknownRow) string { return x.Filename },
			func(x db.UnknownRow) string { return x.ParsedAt },
			func(x *db.UnknownRow, ts string) { x.ParsedAt = ts })
	}
}

// dropSiblingRowsFromSnapshot removes filename's row from every snapshot
// slice except keepType's — the in-memory analog of
// Store.DeleteScreenshotSiblings.
func (st *parseRunState) dropSiblingRowsFromSnapshot(filename, keepType string) {
	if keepType != "summary" {
		st.snap.Summaries = dropRowByFilename(st.snap.Summaries, filename, func(x db.SummaryRow) string { return x.Filename })
	}
	if keepType != "teams" {
		st.snap.Teams = dropRowByFilename(st.snap.Teams, filename, func(x db.TeamsRow) string { return x.Filename })
	}
	if keepType != "personal" {
		st.snap.Personals = dropRowByFilename(st.snap.Personals, filename, func(x db.PersonalRow) string { return x.Filename })
	}
	if keepType != "rank" {
		st.snap.Ranks = dropRowByFilename(st.snap.Ranks, filename, func(x db.RankRow) string { return x.Filename })
	}
	if keepType != "unknown" {
		st.snap.Unknowns = dropRowByFilename(st.snap.Unknowns, filename, func(x db.UnknownRow) string { return x.Filename })
	}
}

func dropRowByFilename[T any](rows []T, filename string, name func(T) string) []T {
	return slices.DeleteFunc(rows, func(r T) bool { return name(r) == filename })
}

// applyAmbiguityToSnapshot mirrors ApplyAmbiguity: wipe the filename's
// candidate set, re-insert iff non-empty (presence IS the ambiguity flag).
func (st *parseRunState) applyAmbiguityToSnapshot(filename string, cands []db.AmbiguousCandidate) {
	if st.snap.AmbiguousCandidates == nil {
		st.snap.AmbiguousCandidates = map[string][]db.AmbiguousCandidate{}
	}
	delete(st.snap.AmbiguousCandidates, filename)
	if len(cands) > 0 {
		st.snap.AmbiguousCandidates[filename] = append([]db.AmbiguousCandidate(nil), cands...)
	}
}
