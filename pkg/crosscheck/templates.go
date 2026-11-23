package crosscheck

import (
	"strconv"

	"recall/pkg/match"
	"recall/pkg/parser"
)

// templateDisagreement flags a field whose reference templates read the same
// pixels as something other than OCR did. The parser records a template
// reading only when it is confident, so every one recorded is held to OCR; a
// field no reference matched carries none and is not judged.
func templateDisagreement(g Group) []finding {
	var out []finding
	for _, s := range g.Sources {
		for _, ev := range s.Evidence {
			if ev.Template == nil {
				continue
			}
			read, ok := ocrValue(s, ev.Field)
			if !ok || sameReading(read, ev.Template.Value) {
				continue
			}
			out = append(out, finding{field: ev.Field, readings: []match.FieldReading{
				ocrReading(s.File, read), templateReading(s.File, ev.Template.Value),
			}})
		}
	}
	return out
}

// ocrValue is what OCR read for field on this screenshot: a stat total or a
// rank card's SR, the numbers the digit templates read.
func ocrValue(s Source, field parser.FieldPath) (string, bool) {
	for _, st := range scalarStats {
		if field == st.path() {
			return strconv.Itoa(st.of(&s.Data)), true
		}
	}
	for _, sr := range s.Data.SR {
		if field == parser.SRPath(sr.Hero) {
			return strconv.Itoa(sr.SR), true
		}
	}
	return "", false
}

// sameReading compares two numbers as numbers, so "09" and "9" agree, and
// anything else as text.
func sameReading(ocr, template string) bool {
	a, errA := strconv.Atoi(ocr)
	b, errB := strconv.Atoi(template)
	if errA == nil && errB == nil {
		return a == b
	}
	return ocr == template
}
