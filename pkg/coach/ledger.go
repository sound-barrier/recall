package coach

import (
	"bytes"
	_ "embed"
	"fmt"
	"html/template"
	"strings"
)

//go:embed ledger.tmpl.html
var ledgerTemplateSource string

// ledgerTemplate is parsed once; html/template's contextual auto-escaping
// is the XSS defense for every coach- and player-supplied string.
var ledgerTemplate = template.Must(
	template.New("ledger").Funcs(template.FuncMap{"label": focusTagLabel}).Parse(ledgerTemplateSource),
)

// ledgerPage is the template's data: the file plus what the markup needs
// precomputed, so the template stays free of logic.
type ledgerPage struct {
	NotesFile
	NoteCount int
	Notes     []ledgerNote
}

type ledgerNote struct {
	Note
	ReviewedOnly bool
}

// RenderLedger renders the human copy of a notes file — one self-contained
// HTML page (inline styles only, a default-src 'none' CSP, no scripts,
// images, or links) the player can open in any browser. The app never
// parses this file back; notes.json is the only ingested artifact.
func RenderLedger(f NotesFile) ([]byte, error) {
	page := ledgerPage{NotesFile: f, NoteCount: len(f.Notes), Notes: make([]ledgerNote, 0, len(f.Notes))}
	for _, n := range f.Notes {
		page.Notes = append(page.Notes, ledgerNote{Note: n, ReviewedOnly: n.Kind == KindReviewedOnly})
	}
	var buf bytes.Buffer
	if err := ledgerTemplate.Execute(&buf, page); err != nil {
		return nil, fmt.Errorf("coach: render ledger: %w", err)
	}
	return buf.Bytes(), nil
}

// focusTagLabel is the display form of a vocabulary tag: "ult_economy"
// reads "ult economy".
func focusTagLabel(tag string) string { return strings.ReplaceAll(tag, "_", " ") }
