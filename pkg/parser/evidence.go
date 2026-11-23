package parser

import (
	"image"
	"strconv"

	"recall/pkg/glyphs"
)

// FieldPath names one field of a match in the dotted vocabulary the edit
// system already speaks: "data.<field>" for a top-level reading,
// "data.heroes_played.<hero>.stats.<key>" for a PERSONAL stat cell. The
// override marks, the evidence rects and anything later keyed on a field share
// this one spelling, so a reading, the region it came from and the edit that
// corrects it all name the same thing.
type FieldPath string

// ScalarPath is the path of a top-level MatchResult field by its JSON name: a
// scalar, or a collection the edit system replaces whole (heroes_played, sr,
// modifiers).
func ScalarPath(field string) FieldPath { return FieldPath("data." + field) }

// HeroStatPath is the path of one hero-specific stat cell.
func HeroStatPath(hero, statKey string) FieldPath {
	return FieldPath("data.heroes_played." + hero + ".stats." + statKey)
}

// HeroPercentPath is the path of one hero's share of the match.
func HeroPercentPath(hero string) FieldPath {
	return FieldPath("data.heroes_played." + hero + ".percent_played")
}

// SRPath is the path of one hero card's SR on the rank screen.
func SRPath(hero string) FieldPath { return FieldPath("data.sr." + hero + ".sr") }

// FieldEvidence is where on the screenshot one field was read, in the source
// image's pixel coordinates: the region the accepted OCR pass saw, or the part
// of it holding the value when the parser can find that. Template is what the
// digit templates read there, nil when none matched with confidence.
type FieldEvidence struct {
	Field    FieldPath
	Rect     image.Rectangle
	Template *TemplateReading
}

// TemplateReading is a second opinion on a field from pkg/glyphs: Value is a
// number's decimal digits. It never changes the value OCR read;
// it sits beside it, so a disagreement can be noticed rather than resolved by
// whichever reader ran last.
type TemplateReading struct {
	Value  string
	Score  float64
	Margin float64
}

// readNumberFunc is the template reader, a seam so a test can read against
// references it drew.
var readNumberFunc = glyphs.ReadNumber

// numberTemplate is what the digit references read in rect, nil when they
// cannot read it with confidence.
func numberTemplate(img image.Image, rect image.Rectangle) *TemplateReading {
	n, ok := readNumberFunc(img, rect)
	if !ok {
		return nil
	}
	return &TemplateReading{Value: strconv.Itoa(n.Value), Score: n.Score, Margin: n.Margin}
}

// recordEvidence notes the region a field's value was read from, clipped to
// the image — the same clip crop applies, so the rect is exactly what OCR saw.
// Callers record only values the pixels produced: a 0 read off the screen
// names its region, a 0 left in place because no pass read anything does not,
// so a region always means "these pixels gave this value".
// A region with nothing inside the image records nothing. A field read twice
// keeps the later region, matching the value it now holds.
func (r *MatchResult) recordEvidence(img image.Image, field FieldPath, rect image.Rectangle) {
	r.recordCrossChecked(img, field, rect, nil)
}

// recordCrossChecked is recordEvidence with what the templates read in rect.
// A later record replaces the template with the region, since a template
// read elsewhere says nothing about the region now recorded.
func (r *MatchResult) recordCrossChecked(img image.Image, field FieldPath, rect image.Rectangle, template *TemplateReading) {
	rect = rect.Intersect(img.Bounds())
	if rect.Empty() {
		return
	}
	evidence := FieldEvidence{Field: field, Rect: rect, Template: template}
	for i := range r.Evidence {
		if r.Evidence[i].Field == field {
			r.Evidence[i] = evidence
			return
		}
	}
	r.Evidence = append(r.Evidence, evidence)
}
