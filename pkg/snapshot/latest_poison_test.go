package snapshot_test

import (
	"os"
	"path/filepath"
	"testing"

	"recall/pkg/snapshot"
)

// Latest takes the lexical max of the matching filenames and THEN parses it,
// so a single file whose stamp does not parse — and which sorts above the real
// ones — poisons the whole read and Latest reports "no backups exist".
//
// The damage is not the false "never backed up" in Settings, and not even the
// snapshot-on-every-parse that follows from Stale being permanently true. It
// is RETENTION: Prune keeps the lexical max, so the poison file occupies one
// of the three kept slots forever, and with a write on every parse the
// auto-backup window collapses from "the last three weekly snapshots" to "the
// last two parse runs" — minutes of history where there should be weeks. The
// safety net thins out exactly when someone would reach for it, and it never
// self-heals.
//
// Only an externally-created file can trigger it (Write always stamps
// time.Now().UTC()), but "the user kept a copy in the backups folder" is an
// ordinary thing to do. Note the asymmetry: the usual auto-generated
// duplicates sort BELOW '.' — "auto-… copy.db", "auto-… (1).db" — and are
// harmless. A LETTER after the prefix is what poisons it.
func TestLatest_IgnoresAFileWhoseStampDoesNotParse(t *testing.T) {
	dir := t.TempDir()
	genuine := []string{
		"auto-20260814-030000.db",
		"auto-20260815-030000.db",
		"auto-20260816-030000.db",
	}
	for _, n := range append(genuine, "auto-keep-this-one.db") {
		if err := os.WriteFile(filepath.Join(dir, n), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	got, ok := snapshot.Latest(dir, "auto-")
	if !ok {
		t.Fatal("Latest reported no backups, but three parseable ones are present — " +
			"one unparseable name must not hide the whole set")
	}
	if want := "2026-08-16"; got.Format("2006-01-02") != want {
		t.Errorf("Latest = %s, want the newest PARSEABLE stamp %s",
			got.Format("2006-01-02"), want)
	}
}

// The honest empty case still has to report empty: a directory holding only
// unparseable names has no backup to name, and claiming otherwise would be
// worse than the bug above.
func TestLatest_ReportsEmptyWhenNothingParses(t *testing.T) {
	dir := t.TempDir()
	for _, n := range []string{"auto-keep-this-one.db", "auto-notes.db"} {
		if err := os.WriteFile(filepath.Join(dir, n), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	if _, ok := snapshot.Latest(dir, "auto-"); ok {
		t.Error("Latest reported a backup, but no filename in the directory carries a parseable stamp")
	}
}

// Prune's half of the same problem. A file this package did not write is not
// ours to count OR to delete: counting it toward `keep` costs a retention slot
// permanently (it is the lexical max, so it is never the one pruned), and
// deleting it would destroy something the user put there deliberately.
func TestPrune_DoesNotSpendARetentionSlotOnAForeignFile(t *testing.T) {
	dir := t.TempDir()
	ours := []string{
		"auto-20260813-030000.db",
		"auto-20260814-030000.db",
		"auto-20260815-030000.db",
		"auto-20260816-030000.db",
	}
	foreign := "auto-keep-this-one.db"
	for _, n := range append(append([]string{}, ours...), foreign) {
		if err := os.WriteFile(filepath.Join(dir, n), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	snapshot.Prune(dir, "auto-", 3)

	if _, err := os.Stat(filepath.Join(dir, foreign)); err != nil {
		t.Errorf("Prune deleted %s — a file it did not write is not its to remove", foreign)
	}
	// keep=3 must mean three of OUR snapshots, so only the oldest ours[0] goes.
	for _, n := range ours[1:] {
		if _, err := os.Stat(filepath.Join(dir, n)); err != nil {
			t.Errorf("%s was pruned; the foreign file consumed a retention slot", n)
		}
	}
	if _, err := os.Stat(filepath.Join(dir, ours[0])); err == nil {
		t.Errorf("%s survived; keep=3 should have retired the oldest of ours", ours[0])
	}
}
