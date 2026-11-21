package db_test

import (
	"image"
	"reflect"
	"sync"
	"testing"

	"recall/pkg/db"
	"recall/pkg/parser"
)

// The two parses the snapshot probe alternates between: the same screenshot
// read at two resolutions, each size paired with the region it was read in.
var evidenceProbeParses = []db.ScreenshotEvidence{
	{ImageSize: image.Pt(1920, 1080), Fields: []parser.FieldEvidence{deathsEvidence(image.Rect(300, 40, 340, 70))}},
	{ImageSize: image.Pt(2560, 1440), Fields: []parser.FieldEvidence{deathsEvidence(image.Rect(400, 53, 453, 93))}},
}

// LoadFieldEvidence must be snapshot-consistent. It reads two tables, and a
// re-parse landing between two independent reads pairs one parse's size with
// another's regions — or, on a file's first parse, regions with no size at
// all. The probe re-parses one screenshot at alternating resolutions (and
// forgets it every third write) under concurrent readers; any record that is
// not exactly one of the written parses is torn.
func TestSQLStore_LoadFieldEvidenceIsSnapshotConsistent(t *testing.T) {
	s, err := db.NewSQLStore(t.TempDir() + "/evidence.db")
	if err != nil {
		t.Fatalf("NewSQLStore: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	dir, err := s.EnsureScreenshotsDir("/shots")
	mustNoErr(t, err)
	file := db.FileRef{DirID: dir, Filename: "shot.png"}

	done := make(chan struct{})
	var wg sync.WaitGroup
	for range 4 {
		wg.Go(func() { watchForTornEvidence(t, s, file, done) })
	}
	for i := range 300 {
		if err := s.ReplaceFieldEvidence(file, evidenceProbeWrite(i)); err != nil {
			t.Errorf("ReplaceFieldEvidence: %v", err)
			break
		}
	}
	close(done)
	wg.Wait()
}

func evidenceProbeWrite(i int) db.ScreenshotEvidence {
	if i%3 == 2 {
		return db.ScreenshotEvidence{}
	}
	return evidenceProbeParses[i%3]
}

// watchForTornEvidence loads evidence until done closes, failing on any
// record for file that is neither absent nor exactly one written parse.
func watchForTornEvidence(t *testing.T, s *db.SQLStore, file db.FileRef, done <-chan struct{}) {
	t.Helper()
	for {
		select {
		case <-done:
			return
		default:
		}
		all, err := s.LoadFieldEvidence()
		if err != nil {
			t.Errorf("LoadFieldEvidence: %v", err)
			return
		}
		if got, ok := all[file]; ok && !isProbeParse(got) {
			t.Errorf("torn evidence record: %+v", got)
			return
		}
	}
}

func isProbeParse(ev db.ScreenshotEvidence) bool {
	for _, parse := range evidenceProbeParses {
		if reflect.DeepEqual(ev, parse) {
			return true
		}
	}
	return false
}
