package matchedit_test

import (
	"errors"
	"reflect"
	"slices"
	"testing"

	"recall/pkg/db"
	"recall/pkg/db/dbtest"
	"recall/pkg/match"
	"recall/pkg/matchedit"
)

func TestIgnoreScreenshot_RejectsEmptyFilename(t *testing.T) {
	if err := matchedit.IgnoreScreenshot(dbtest.New(), ""); !errors.Is(err, matchedit.ErrIgnoreFilenameRequired) {
		t.Errorf("got err=%v, want ErrIgnoreFilenameRequired", err)
	}
}

func TestIgnoreScreenshot_AddsToSetAndWipesBothKeyShapes(t *testing.T) {
	// Seed an unmatched- row AND an ambiguous- row pointing at the
	// same filename. IgnoreScreenshot must wipe both via
	// HardDeleteMatch so the Unknown card disappears immediately.
	// The sentinel keys are now base64url-encoded, so build them via the
	// constructors rather than hand-concatenating the filename.
	encU := match.NewUnmatchedMatchKey("sb.png").String()
	encA := match.NewAmbiguousMatchKey("sb.png").String()
	fake := &dbtest.Fake{
		Teams: []db.TeamsRow{
			{Filename: "sb.png", MatchKey: encU},
			{Filename: "sb2.png", MatchKey: encA},
		},
	}

	mustNoErr(t, matchedit.IgnoreScreenshot(fake, "sb.png"))

	// Filename is now in the suppress-list.
	got, _ := fake.LoadIgnoredFilenames()
	if !got["sb.png"] {
		t.Errorf("filename not added to ignore set; got=%v", got)
	}

	// Both candidate keys went through HardDeleteMatch.
	wantCalls := []string{encU, encA}
	if !reflect.DeepEqual(fake.HardDeleteCalls, wantCalls) {
		t.Errorf("HardDeleteCalls = %v, want %v", fake.HardDeleteCalls, wantCalls)
	}
}

// Reproduces the user-reported bug: an Unknown card whose match_key is
// match-<ts> (a tracked match where the OCR failed to extract a map
// name, so the aggregator surfaces it on the Unknown tab via
// `!r.data?.map && !r.ambiguous`) — clicking "Delete forever" should
// wipe THAT match row too, not just the unmatched- / ambiguous- key
// shapes. Pre-fix: the card never disappeared because the actual
// match-<ts> row stayed and the next reload re-rendered it.
func TestIgnoreScreenshot_WipesTrackedMatchKeyTooNotJustUnmatchedAndAmbiguous(t *testing.T) {
	fake := &dbtest.Fake{
		Summaries: []db.SummaryRow{
			// A tracked match whose summary references "broken.png" but
			// has no Map (the parser failed to OCR it) — surfaces on the
			// Unknown tab.
			{Filename: "broken.png", MatchKey: "match-2026-05-10T22-21-11", Map: ""},
		},
	}

	mustNoErr(t, matchedit.IgnoreScreenshot(fake, "broken.png"))

	// HardDeleteMatch must be called for the actual match_key too —
	// not just the two name-shaped fallback keys.
	wantSubset := "match-2026-05-10T22-21-11"
	if !slices.Contains(fake.HardDeleteCalls, wantSubset) {
		t.Errorf("HardDeleteCalls = %v, missing actual match key %q", fake.HardDeleteCalls, wantSubset)
	}
}

// A tracked key the lookup returns that is ALSO one of the two
// name-shaped fallbacks is deleted once, not twice — the dedupe keeps
// the audit log and the test expectations honest.
func TestIgnoreScreenshot_DeletesEachKeyOnce(t *testing.T) {
	encU := match.NewUnmatchedMatchKey("dupe.png").String()
	fake := &dbtest.Fake{
		Summaries: []db.SummaryRow{{Filename: "dupe.png", MatchKey: encU}},
	}
	mustNoErr(t, matchedit.IgnoreScreenshot(fake, "dupe.png"))
	if n := slices.Index(fake.HardDeleteCalls, encU); n != 0 {
		t.Fatalf("HardDeleteCalls = %v, want the unmatched key first", fake.HardDeleteCalls)
	}
	if got := slices.Contains(fake.HardDeleteCalls[1:], encU); got {
		t.Errorf("HardDeleteCalls = %v, deleted the same key twice", fake.HardDeleteCalls)
	}
}

func TestIgnoreScreenshot_IsIdempotent(t *testing.T) {
	fake := dbtest.New()
	mustNoErr(t, matchedit.IgnoreScreenshot(fake, "dup.png"))
	mustNoErr(t, matchedit.IgnoreScreenshot(fake, "dup.png"))
	got, _ := fake.LoadIgnoredFilenames()
	if !got["dup.png"] {
		t.Errorf("filename absent after duplicate ignores; got=%v", got)
	}
}

func TestUnignoreScreenshot_RemovesFromSet(t *testing.T) {
	fake := dbtest.New()
	mustNoErr(t, matchedit.IgnoreScreenshot(fake, "toggle.png"))
	mustNoErr(t, matchedit.UnignoreScreenshot(fake, "toggle.png"))
	got, _ := fake.LoadIgnoredFilenames()
	if got["toggle.png"] {
		t.Errorf("filename still present after unignore; got=%v", got)
	}
}

func TestUnignoreScreenshot_RejectsEmptyFilename(t *testing.T) {
	if err := matchedit.UnignoreScreenshot(dbtest.New(), ""); !errors.Is(err, matchedit.ErrIgnoreFilenameRequired) {
		t.Errorf("got err=%v, want ErrIgnoreFilenameRequired", err)
	}
}

func TestListIgnoredScreenshots_ReturnsRichRowsWithTimestamps(t *testing.T) {
	fake := dbtest.New()
	for _, f := range []string{"zoo.png", "alpha.png", "middle.png"} {
		mustNoErr(t, matchedit.IgnoreScreenshot(fake, f))
	}
	out, err := matchedit.ListIgnoredScreenshots(fake)
	mustNoErr(t, err)
	if len(out) != 3 {
		t.Fatalf("expected 3 rows, got %d", len(out))
	}
	// Tie-break on IgnoredAt ties (three rapid Adds within one second
	// land at the same RFC3339 second) is filename ASC.
	want := []string{"alpha.png", "middle.png", "zoo.png"}
	for i, w := range want {
		if out[i].Filename != w {
			t.Errorf("row[%d].Filename = %q, want %q", i, out[i].Filename, w)
		}
		if out[i].IgnoredAt == "" {
			t.Errorf("row[%d].IgnoredAt empty; expected timestamp", i)
		}
	}
}

func TestClearIgnoredScreenshots_TruncatesSuppressList(t *testing.T) {
	fake := dbtest.New()
	for _, f := range []string{"a.png", "b.png"} {
		mustNoErr(t, matchedit.IgnoreScreenshot(fake, f))
	}
	mustNoErr(t, matchedit.ClearIgnoredScreenshots(fake))
	out, err := matchedit.ListIgnoredScreenshots(fake)
	mustNoErr(t, err)
	if len(out) != 0 {
		t.Errorf("expected empty list after ClearIgnoredScreenshots; got %v", out)
	}
}
