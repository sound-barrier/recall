package dbtest

import (
	"errors"
	"image"
	"maps"
	"slices"
	"strings"

	"recall/pkg/db"
	"recall/pkg/parser"
)

// The refusals mirror screenshot_images' and screenshot_field_evidence's
// CHECK constraints, primary key and folder foreign key.
var (
	errEvidenceWithoutSize = errors.New("field evidence without a positive image size")
	errEvidenceBadRegion   = errors.New("field evidence region is empty or outside the image's origin")
	errEvidenceNoField     = errors.New("field evidence without a field path")
	errEvidenceRepeated    = errors.New("field evidence reads one field twice")
	errEvidenceNoFolder    = errors.New("field evidence filed under an unknown screenshots folder")
)

// ReplaceFieldEvidence mirrors SQLStore: the record is replaced whole, an
// empty one forgets the screenshot, and a refused one leaves the earlier
// record as it was (SQLStore's transaction rolls its DELETE back).
func (f *Fake) ReplaceFieldEvidence(file db.FileRef, ev db.ScreenshotEvidence) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	file = file.Filed()
	if ev.ImageSize == (image.Point{}) && len(ev.Fields) == 0 {
		delete(f.FieldEvidence, file)
		return nil
	}
	if err := f.checkEvidenceLocked(file, ev); err != nil {
		return err
	}
	if f.FieldEvidence == nil {
		f.FieldEvidence = map[db.FileRef]db.ScreenshotEvidence{}
	}
	f.FieldEvidence[file] = copyEvidence(ev)
	return nil
}

// checkEvidenceLocked refuses what the SQL schema refuses. Callers hold f.mu.
func (f *Fake) checkEvidenceLocked(file db.FileRef, ev db.ScreenshotEvidence) error {
	if !f.knowsDirLocked(file.DirID) {
		return errEvidenceNoFolder
	}
	if ev.ImageSize.X <= 0 || ev.ImageSize.Y <= 0 {
		return errEvidenceWithoutSize
	}
	seen := map[parser.FieldPath]bool{}
	for _, field := range ev.Fields {
		if err := checkFieldEvidence(field, seen); err != nil {
			return err
		}
		seen[field.Field] = true
	}
	return nil
}

func checkFieldEvidence(field parser.FieldEvidence, seen map[parser.FieldPath]bool) error {
	switch {
	case field.Field == "":
		return errEvidenceNoField
	case seen[field.Field]:
		return errEvidenceRepeated
	case field.Rect.Min.X < 0 || field.Rect.Min.Y < 0 || field.Rect.Dx() <= 0 || field.Rect.Dy() <= 0:
		return errEvidenceBadRegion
	}
	return nil
}

// knowsDirLocked reports whether id names a screenshots_dirs row: the
// sentinel or one EnsureScreenshotsDir handed out. Callers hold f.mu.
func (f *Fake) knowsDirLocked(id int64) bool {
	return id == db.SentinelScreenshotsDirID || slices.Contains(slices.Collect(maps.Values(f.DirIDs)), id)
}

// LoadFieldEvidence mirrors SQLStore: fields ordered by path, and copies the
// caller may keep.
func (f *Fake) LoadFieldEvidence() (map[db.FileRef]db.ScreenshotEvidence, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.fieldEvidenceLocked(), nil
}

// fieldEvidenceLocked copies every evidence record. Callers hold f.mu.
func (f *Fake) fieldEvidenceLocked() map[db.FileRef]db.ScreenshotEvidence {
	out := make(map[db.FileRef]db.ScreenshotEvidence, len(f.FieldEvidence))
	for file, ev := range f.FieldEvidence {
		out[file] = copyEvidence(ev)
	}
	return out
}

func copyEvidence(ev db.ScreenshotEvidence) db.ScreenshotEvidence {
	out := db.ScreenshotEvidence{ImageSize: ev.ImageSize}
	for _, field := range ev.Fields {
		if field.Template != nil {
			template := *field.Template
			field.Template = &template
		}
		out.Fields = append(out.Fields, field)
	}
	slices.SortFunc(out.Fields, func(a, b parser.FieldEvidence) int { return strings.Compare(string(a.Field), string(b.Field)) })
	return out
}

// forgetEvidenceLocked drops the records of every screenshot doomed names.
// Callers hold f.mu.
func (f *Fake) forgetEvidenceLocked(doomed func(db.FileRef) bool) {
	maps.DeleteFunc(f.FieldEvidence, func(file db.FileRef, _ db.ScreenshotEvidence) bool { return doomed(file) })
}
