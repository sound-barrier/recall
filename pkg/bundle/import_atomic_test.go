package bundle_test

import (
	"errors"
	"testing"

	"recall/pkg/bundle"
	"recall/pkg/db"
	"recall/pkg/db/dbtest"
)

// failingUserLayer fails the annotation write — standing in for a crash or a
// full disk between the parent rows and the user layer.
type failingUserLayer struct{ *dbtest.Fake }

func (f failingUserLayer) SetAnnotationAt(db.Annotation) error {
	return errors.New("disk full")
}

func (f failingUserLayer) InTransaction(fn func(db.Store) error) error {
	return f.Fake.InTransaction(func(db.Store) error { return fn(f) })
}

// An import is one unit. It used to write the parent rows and then the user
// layer as separate steps, so a failure in between stranded the parents —
// and a retry skipped them as already present, so the user layer never came.
func TestImport_AFailurePartWayLeavesNothingBehind(t *testing.T) {
	dst := dbtest.New()
	_, err := bundle.Import(failingUserLayer{Fake: dst}, payloadWithData(t, allTablesData()))
	if err == nil {
		t.Fatal("Import succeeded through a failing annotation write")
	}
	if n := len(dst.Summaries) + len(dst.Teams) + len(dst.Personals) + len(dst.Ranks) + len(dst.Unknowns); n != 0 {
		t.Errorf("a failed import left %d parent rows behind", n)
	}
	if len(dst.UserMatchData) != 0 {
		t.Errorf("a failed import left user match data behind: %+v", dst.UserMatchData)
	}
}
