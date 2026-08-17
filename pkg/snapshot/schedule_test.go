package snapshot_test

import (
	"errors"
	"path/filepath"
	"testing"
	"time"

	"recall/pkg/snapshot"
)

// The stored setting is a tri-state squeezed into one int, and the three arms
// are not symmetric: 0 is "never configured" and must default ON, because the
// users the scheduler exists for are exactly the ones who never open Settings.
// Reading -1 and 0 as "the same kind of falsy" would silently disable backups
// for every fresh install.
func TestEffectiveDays_MapsTheStoredTriState(t *testing.T) {
	for _, tc := range []struct {
		name       string
		configured int
		want       int
	}{
		{"unset defaults on at a week", 0, snapshot.DefaultDays},
		{"-1 is an explicit opt-out", -1, -1},
		{"any negative is an opt-out", -5, -1},
		{"a positive value is literal days", 30, 30},
		{"one day is literal, not falsy", 1, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := snapshot.EffectiveDays(tc.configured); got != tc.want {
				t.Errorf("EffectiveDays(%d) = %d, want %d", tc.configured, got, tc.want)
			}
		})
	}
}

func TestValidateInterval_AcceptsTheWholeDocumentedRange(t *testing.T) {
	for _, days := range []int{-1, 0, 1, 30, snapshot.MaxDays} {
		if err := snapshot.ValidateInterval(days); err != nil {
			t.Errorf("ValidateInterval(%d) = %v, want nil — the wire contract is a plain bounded integer", days, err)
		}
	}
	for _, days := range []int{-2, snapshot.MaxDays + 1} {
		err := snapshot.ValidateInterval(days)
		if !errors.Is(err, snapshot.ErrInvalidInterval) {
			t.Errorf("ValidateInterval(%d) = %v, want ErrInvalidInterval", days, err)
		}
	}
}

// The rejection message is the problem+json detail the client reads, so the
// bound has to appear in it rather than only in the docs.
func TestValidateInterval_NamesTheValueAndTheBound(t *testing.T) {
	got := snapshot.ValidateInterval(400).Error()
	want := "invalid auto-backup interval: 400 (want -1..365)"
	if got != want {
		t.Errorf("detail = %q, want %q", got, want)
	}
}

// Latest' whole design is that the name IS the clock: it never stats a file,
// so lexical max has to equal newest, and it has to stay inside its prefix.
func TestLatest_ReadsTheNewestStampWithinItsOwnPrefix(t *testing.T) {
	dir := t.TempDir()
	touch(t, dir,
		"auto-20260701-095959.db",
		"auto-20260701-100000.db",
		"pre-reparse-20260930-235959.db", // a newer FOREIGN snapshot
	)

	got, ok := snapshot.Latest(dir, snapshot.AutoPrefix)
	if !ok {
		t.Fatal("Latest found nothing")
	}
	want := time.Date(2026, 7, 1, 10, 0, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Errorf("Latest = %s, want %s — the other prefix is a different schedule", got, want)
	}
}

// Both producers write into ONE directory, so the same second can carry a
// snapshot under each prefix. Each prefix must still read its own.
func TestLatest_SeparatesPrefixesThatShareASecond(t *testing.T) {
	dir := t.TempDir()
	touch(t, dir, "auto-20260701-100000.db", "pre-reparse-20260701-100000.db")
	want := time.Date(2026, 7, 1, 10, 0, 0, 0, time.UTC)

	for _, prefix := range []string{snapshot.AutoPrefix, snapshot.ReparsePrefix} {
		got, ok := snapshot.Latest(dir, prefix)
		if !ok || !got.Equal(want) {
			t.Errorf("Latest(%q) = %s (ok=%v), want %s", prefix, got, ok, want)
		}
	}
}

// REVERSED, deliberately. This used to pin the opposite: a name the layout
// could not parse read as "no snapshot", on the reasoning that making the next
// backup look due is "the safe direction to be wrong in".
//
// That reasoning assumed the wrongness was transient. It is not — it is
// permanent and self-reinforcing. A foreign file in backups/ sorts above every
// real stamp whenever the character after the prefix is a letter, so Latest
// reported "never backed up" forever: Stale stayed true, a snapshot was
// written after every parse, and Prune kept the foreign file as its own
// lexical max. The retention window collapsed from three weekly snapshots to
// the last two parse runs, and Settings showed a permanent red "never backed
// up" while backups were in fact being written constantly. Erring toward more
// backups is only safe if the extra ones are KEPT.
//
// Both halves of that are now fixed, and the honest-empty case is pinned
// separately in latest_poison_test.go: if nothing parses, Latest still reports
// nothing.
func TestLatest_IgnoresAMalformedStampBesideAGoodOne(t *testing.T) {
	dir := t.TempDir()
	touch(t, dir, "auto-20260701-100000.db", "auto-not-a-stamp.db")

	got, ok := snapshot.Latest(dir, snapshot.AutoPrefix)
	if !ok {
		t.Fatal("Latest reported nothing; the parseable stamp beside the foreign file is a real snapshot")
	}
	if want := "2026-07-01"; got.Format("2006-01-02") != want {
		t.Errorf("Latest = %s, want %s", got.Format("2006-01-02"), want)
	}
}

func TestLatest_ReportsNothingForAnEmptyOrUnglobbableDirectory(t *testing.T) {
	if _, ok := snapshot.Latest(t.TempDir(), snapshot.AutoPrefix); ok {
		t.Error("an empty backups directory has no latest snapshot")
	}
	if _, ok := snapshot.Latest(filepath.Join(t.TempDir(), "profile[1"), snapshot.AutoPrefix); ok {
		t.Error("an unglobbable path has no latest snapshot")
	}
}

func TestStatusFor_ReportsDueWhenNothingHasEverBeenWritten(t *testing.T) {
	st := snapshot.StatusFor(t.TempDir(), 0, time.Now())

	if st.IntervalDays != snapshot.DefaultDays {
		t.Errorf("IntervalDays = %d, want the default %d", st.IntervalDays, snapshot.DefaultDays)
	}
	if !st.Stale || st.LastBackupAt != "" {
		t.Errorf("no snapshots yet must read stale with no timestamp: %+v", st)
	}
}

func TestStatusFor_JudgesFreshnessAgainstTheNewestSnapshot(t *testing.T) {
	dir := t.TempDir()
	now := time.Date(2026, 7, 8, 12, 0, 0, 0, time.UTC)
	touch(t, dir, "auto-20260101-000000.db", "auto-20260707-120000.db")

	st := snapshot.StatusFor(dir, 7, now)

	if st.Stale {
		t.Errorf("a day-old weekly snapshot is not stale: %+v", st)
	}
	want := time.Date(2026, 7, 7, 12, 0, 0, 0, time.UTC).Format(time.RFC3339)
	if st.LastBackupAt != want {
		t.Errorf("LastBackupAt = %q, want the NEWEST snapshot %q", st.LastBackupAt, want)
	}
}

// The boundary is an inequality, not a rounding: a snapshot exactly one
// interval old is still current, and the very next instant it is not.
func TestStatusFor_TurnsStaleOnlyPastAWholeInterval(t *testing.T) {
	dir := t.TempDir()
	touch(t, dir, "auto-20260701-000000.db")
	written := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)

	if st := snapshot.StatusFor(dir, 7, written.AddDate(0, 0, 7)); st.Stale {
		t.Errorf("exactly one interval old is not yet stale: %+v", st)
	}
	if st := snapshot.StatusFor(dir, 7, written.AddDate(0, 0, 7).Add(time.Second)); !st.Stale {
		t.Errorf("a second past the interval is stale: %+v", st)
	}
}

// Disabled means the scheduler never fires, but the user still gets to see
// when the last snapshot was taken — the timestamp is history, not a due date.
func TestStatusFor_NeverGoesStaleWhileDisabled(t *testing.T) {
	dir := t.TempDir()
	touch(t, dir, "auto-20260101-000000.db")

	st := snapshot.StatusFor(dir, -1, time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC))

	if st.IntervalDays != -1 || st.Stale {
		t.Errorf("a disabled schedule is never overdue: %+v", st)
	}
	if st.LastBackupAt == "" {
		t.Error("a disabled schedule still reports the last snapshot it has")
	}
}
