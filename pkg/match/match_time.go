package match

import "time"

// wallClockLayout is the naive local date+time the parser stores:
// `date` ("2006-01-02") joined to `finished_at` ("15:04") with a "T".
const wallClockLayout = "2006-01-02T15:04"

// LocalWallClockToUTC converts a match's naive local date + finished_at
// (the OCR scoreboard wall clock, which carries no timezone) into the
// canonical UTC instant, by interpreting the wall clock in `loc` — the
// machine's timezone IDENTITY (e.g. America/Denver), NOT a fixed offset.
// Because loc is a full zone with DST rules, the correct offset is chosen
// from the match's OWN date: a January match resolves as MST (UTC-7), a
// July match as MDT (UTC-6).
//
// Returns ok=false when either field is empty or the pair doesn't parse,
// so callers store NULL rather than a bogus instant. loc is a parameter
// (production passes time.Local; tests inject a loaded zone) — the only
// timezone seam in the codebase.
//
// This is ADDITIVE: the naive date/finished_at and the match_key stay
// naive-local for the correlator's cross-axis HH:MM comparisons. The
// returned instant is a separate canonical value, never a re-encoding.
func LocalWallClockToUTC(date, finishedAt string, loc *time.Location) (time.Time, bool) {
	if date == "" || finishedAt == "" || loc == nil {
		return time.Time{}, false
	}
	t, err := time.ParseInLocation(wallClockLayout, date+"T"+finishedAt, loc)
	if err != nil {
		return time.Time{}, false
	}
	return t.UTC(), true
}
