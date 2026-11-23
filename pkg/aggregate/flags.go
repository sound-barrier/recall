package aggregate

import (
	"slices"
	"strings"

	"recall/pkg/db"
	"recall/pkg/match"
	"recall/pkg/parser"
)

// AttachFieldResolutions sets where each flag stands with the user. Runs after
// AttachUserData, whose EditedFields it reads.
func AttachFieldResolutions(recs []match.Record, confirmed map[string]db.ConfirmedReadings) {
	for i := range recs {
		resolveFlags(&recs[i], confirmed[recs[i].MatchKey])
	}
}

// resolveFlags is AttachFieldResolutions for one record, shared with the
// single-match read so the two cannot disagree.
func resolveFlags(rec *match.Record, confirmed db.ConfirmedReadings) {
	for i := range rec.FieldFlags {
		rec.FieldFlags[i].State = flagState(rec.FieldFlags[i], rec.EditedFields, confirmed)
	}
}

// clearedBy names, for each field an edit clears rather than replaces, the
// edited paths that clear it. The rank percentile was measured against the
// rank and level the screenshot showed, so applyScalarOverrides drops it when
// either is edited, and a flag on it then names a value the record no longer
// shows.
var clearedBy = map[parser.FieldPath][]parser.FieldPath{
	parser.ScalarPath("rank_percentile"): {parser.ScalarPath("rank"), parser.ScalarPath("level")},
}

// flagState: edited when the user edited the field, a collection holding it,
// or a field whose edit clears it; confirmed when they confirmed the value the
// match reads now; open otherwise. A confirmation of another value is stale —
// a later parse read something the user never looked at — so the flag
// re-opens.
func flagState(flag match.FieldFlag, edited []string, confirmed db.ConfirmedReadings) match.FlagState {
	settles := func(path string) bool {
		return covers(parser.FieldPath(path), flag.Field) || slices.Contains(clearedBy[flag.Field], parser.FieldPath(path))
	}
	if slices.ContainsFunc(edited, settles) {
		return match.FlagEdited
	}
	if value, ok := confirmed[flag.Field]; ok && value == flag.Value {
		return match.FlagConfirmed
	}
	return match.FlagOpen
}

// covers reports whether an edit of path replaced field: the same path, or a
// collection the field sits inside. Only at a "." boundary, so data.rank does
// not cover data.rank_progress.
func covers(path, field parser.FieldPath) bool {
	return field == path || strings.HasPrefix(string(field), string(path)+".")
}
