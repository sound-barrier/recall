package coach_test

import (
	"regexp"
	"strings"
	"testing"

	"recall/pkg/coach"
)

const ledgerCSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`

func renderLedger(t *testing.T, f coach.NotesFile) string {
	t.Helper()
	b, err := coach.RenderLedger(f)
	if err != nil {
		t.Fatalf("RenderLedger: %v", err)
	}
	return string(b)
}

func TestRenderLedger_Smoke(t *testing.T) {
	f := validNotesFile()
	f.Notes[0].ExtraTags = []string{"tempo"}
	out := renderLedger(t, f)

	if !strings.HasPrefix(out, "<!doctype html>") {
		t.Errorf("ledger does not start with a doctype: %.40q", out)
	}
	for _, want := range []string{
		`<meta charset="utf-8">`, ledgerCSP, "<style>",
		"Ordo", "Sable", "2026-08-15", "2026-08-15T09:12:00Z", seedVersion, "2 notes",
		"What to work on", "Work on ult timing.",
		"ilios", "ana", "victory", "2026-08-01", "18:30", "player's local time",
		"positioning", "tempo", "[06:40]", "hold high ground",
		"Reviewed — nothing to add.",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("ledger lacks %q", want)
		}
	}
	for _, forbidden := range []string{"<script", "<img", "<a ", "href=", "src=", "http://", "https://", "@import", "url("} {
		if strings.Contains(out, forbidden) {
			t.Errorf("ledger contains %q — it must be self-contained with no external reach", forbidden)
		}
	}
	if !strings.Contains(out, "white-space: pre-wrap") && !strings.Contains(out, "white-space:pre-wrap") {
		t.Error("note text is not rendered pre-wrap")
	}
	if strings.Count(out, "<meta ") != 3 {
		// charset, CSP, viewport — no other meta reaches out anywhere.
		t.Errorf("unexpected meta tags: %d", strings.Count(out, "<meta "))
	}
}

func TestRenderLedger_OmitsAnEmptyFocusList(t *testing.T) {
	f := validNotesFile()
	f.FocusItems = nil
	if out := renderLedger(t, f); strings.Contains(out, "What to work on") {
		t.Error("focus heading rendered for an empty list")
	}
}

func TestRenderLedger_ListsEveryFocusItemInOrder(t *testing.T) {
	f := validNotesFile()
	f.FocusItems = []coach.FocusItem{
		{ItemID: focusIDOne, Text: "FIRST-ITEM"},
		{ItemID: focusIDTwo, Text: "SECOND-ITEM"},
	}
	out := renderLedger(t, f)
	if !strings.Contains(out, "What to work on") {
		t.Fatal("focus heading missing")
	}
	if strings.Index(out, "FIRST-ITEM") > strings.Index(out, "SECOND-ITEM") {
		t.Error("focus items rendered out of file order")
	}
}

func TestRenderLedger_RendersNotesInFileOrderWithoutContext(t *testing.T) {
	f := validNotesFile()
	f.Notes[0].Match = nil
	f.Notes[0].Text = "FIRST-NOTE"
	f.Notes[1].Kind = "note"
	f.Notes[1].Text = "SECOND-NOTE"
	out := renderLedger(t, f)
	if strings.Index(out, "FIRST-NOTE") > strings.Index(out, "SECOND-NOTE") {
		t.Error("notes rendered out of file order")
	}
	if !strings.Contains(out, keyIlios) {
		t.Error("a note without a match snapshot must still identify its match by key")
	}
}

var scriptTag = regexp.MustCompile(`(?i)<script`)

// Auto-escaping is the XSS defense: hostile text, handle, coach name, and
// tags all land as inert text.
func TestRenderLedger_EscapesEverything(t *testing.T) {
	hostile := `<script>alert(1)</script>`
	f := validNotesFile()
	f.CoachName = hostile
	f.Player.Handle = hostile
	f.FocusItems = []coach.FocusItem{{ItemID: focusIDOne, Text: hostile}}
	f.Notes[0].Text = hostile
	f.Notes[0].ExtraTags = []string{hostile}
	f.Notes[0].Match.Map = hostile
	f.Notes[0].MatchClock = "06:40"
	out := renderLedger(t, f)

	if scriptTag.MatchString(out) {
		t.Errorf("ledger contains an unescaped <script>: %s", out)
	}
	if !strings.Contains(out, "&lt;script&gt;alert(1)&lt;/script&gt;") {
		t.Error("hostile text was not escaped as text")
	}
	for _, forbidden := range []string{"href=", "src=", "http://", "https://"} {
		if strings.Contains(out, forbidden) {
			t.Errorf("ledger contains %q", forbidden)
		}
	}
}
