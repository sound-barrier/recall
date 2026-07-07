package match_test

import (
	"testing"
	"time"

	"recall/pkg/match"
)

// denver is the user's timezone identity — a full zone with DST rules,
// so the offset is chosen from each match's own date. Skips if the host
// has no zoneinfo (CI images ship it; belt-and-braces).
func denver(t *testing.T) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation("America/Denver")
	if err != nil {
		t.Skipf("no America/Denver zoneinfo: %v", err)
	}
	return loc
}

func TestLocalWallClockToUTC_OffsetChosenFromMatchDate(t *testing.T) {
	loc := denver(t)
	// Winter: MST = UTC-7, so 12:00 local → 19:00Z.
	if got, ok := match.LocalWallClockToUTC("2026-01-15", "12:00", loc); !ok || !got.Equal(time.Date(2026, 1, 15, 19, 0, 0, 0, time.UTC)) {
		t.Errorf("January: got %v ok=%v, want 2026-01-15T19:00:00Z", got, ok)
	}
	// Summer: MDT = UTC-6, so 12:00 local → 18:00Z. Same wall clock,
	// different instant — the whole point of using the zone identity.
	if got, ok := match.LocalWallClockToUTC("2026-07-15", "12:00", loc); !ok || !got.Equal(time.Date(2026, 7, 15, 18, 0, 0, 0, time.UTC)) {
		t.Errorf("July: got %v ok=%v, want 2026-07-15T18:00:00Z", got, ok)
	}
}

func TestLocalWallClockToUTC_SpringForwardGap(t *testing.T) {
	loc := denver(t)
	// 2026-03-08 02:30 MST does not exist (clocks jump 02:00→03:00).
	// Go maps a gap time forward by the offset; assert it doesn't crash
	// and lands on a real instant in the post-transition offset (MDT).
	got, ok := match.LocalWallClockToUTC("2026-03-08", "02:30", loc)
	if !ok {
		t.Fatal("spring-forward gap must still produce an instant")
	}
	// Go normalizes the nonexistent 02:30 by interpreting it at the
	// post-transition offset (MDT, UTC-6) → 08:30Z. Deterministic and
	// crash-free is what matters; this pins the actual behavior.
	if !got.Equal(time.Date(2026, 3, 8, 8, 30, 0, 0, time.UTC)) {
		t.Errorf("spring-forward: got %v, want 2026-03-08T08:30:00Z", got)
	}
}

func TestLocalWallClockToUTC_FallBackOverlap(t *testing.T) {
	loc := denver(t)
	// 2026-11-01 01:30 occurs twice (02:00→01:00 fall back). Go picks the
	// earlier (pre-transition, MDT UTC-6) instant per its documented rule.
	got, ok := match.LocalWallClockToUTC("2026-11-01", "01:30", loc)
	if !ok {
		t.Fatal("fall-back overlap must produce an instant")
	}
	if !got.Equal(time.Date(2026, 11, 1, 7, 30, 0, 0, time.UTC)) {
		t.Errorf("fall-back: got %v, want 2026-11-01T07:30:00Z (earlier/MDT instant)", got)
	}
}

func TestLocalWallClockToUTC_RoundTripStationary(t *testing.T) {
	loc := denver(t)
	// Store UTC → render back in the same zone → original wall clock, on
	// both sides of both DST transitions.
	for _, tc := range []struct{ date, hm string }{
		{"2026-01-15", "21:08"}, // MST
		{"2026-07-15", "21:08"}, // MDT
		{"2026-03-09", "21:08"}, // day after spring-forward
		{"2026-11-02", "21:08"}, // day after fall-back
	} {
		utc, ok := match.LocalWallClockToUTC(tc.date, tc.hm, loc)
		if !ok {
			t.Fatalf("%s %s: convert failed", tc.date, tc.hm)
		}
		back := utc.In(loc).Format(wallClockLayoutForTest)
		if back != tc.date+"T"+tc.hm {
			t.Errorf("%s %s round-trip: got %s", tc.date, tc.hm, back)
		}
	}
}

const wallClockLayoutForTest = "2006-01-02T15:04"

func TestLocalWallClockToUTC_MissingFieldsReturnNotOK(t *testing.T) {
	loc := denver(t)
	for _, tc := range []struct{ date, hm string }{
		{"", "12:00"}, {"2026-01-15", ""}, {"garbage", "nope"}, {"2026-13-40", "99:99"},
	} {
		if _, ok := match.LocalWallClockToUTC(tc.date, tc.hm, loc); ok {
			t.Errorf("(%q,%q) should return ok=false", tc.date, tc.hm)
		}
	}
	if _, ok := match.LocalWallClockToUTC("2026-01-15", "12:00", nil); ok {
		t.Error("nil location should return ok=false")
	}
}
