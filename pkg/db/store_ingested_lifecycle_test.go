package db_test

import (
	"testing"

	"recall/pkg/db"
)

// The dedup registry decides what the parse loop skips BEFORE OCR, and a
// standing duplicate is skipped on every run — ReParseAll included. So a row
// that outlives its file's reason for existing is not stale data, it is a
// screenshot the app will never look at again.
//
// Clear says it "deletes every row in every table"; the registry was not in
// either of its lists.
func TestStoreContract_ClearEmptiesTheDedupRegistry(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			mustNoErr(t, s.UpsertIngestedFile("a.png", "hash-1", ""))
			mustNoErr(t, s.UpsertIngestedFile("b.png", "hash-1", "a.png"))

			mustNoErr(t, s.Clear())

			reg, err := s.LoadIngestedFiles()
			mustNoErr(t, err)
			if len(reg) != 0 {
				t.Errorf("registry after Clear = %+v, want empty — b.png can never be re-parsed while its row stands", reg)
			}
		})
	}
}

// Delete forever takes the match's screenshots out of the corpus, and their
// registry rows with them — otherwise the files stay suppressed with nothing
// left to point at.
//
// The copy goes too, by cascade. Steam saves a.png and the shortcut saves an
// identical b.png; b.png is registered as a duplicate and never OCR'd. Once
// a.png's row is gone, nothing knows what b.png is a copy OF, and leaving it
// marked as one costs the player a recoverable match with no diagnostic
// anywhere: no parent row, no failed entry, nothing on the Unknown tab.
func TestStoreContract_DeletingAMatchForgetsItsFilesAndTheirCopies(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			mustNoErr(t, s.UpsertSummary(db.SummaryRow{
				Filename: "a.png", MatchKey: "m1", Map: "ilios",
			}))
			mustNoErr(t, s.UpsertIngestedFile("a.png", "hash-1", ""))
			mustNoErr(t, s.UpsertIngestedFile("b.png", "hash-1", "a.png"))
			mustNoErr(t, s.UpsertIngestedFile("z.png", "hash-9", ""))

			mustNoErr(t, s.HardDeleteMatch("m1"))

			reg, err := s.LoadIngestedFiles()
			mustNoErr(t, err)
			if _, ok := reg["a.png"]; ok {
				t.Error("a.png kept its registry row after its match was deleted")
			}
			if _, ok := reg["b.png"]; ok {
				t.Error("b.png stayed a standing duplicate of a file that no longer exists")
			}
			if _, ok := reg["z.png"]; !ok {
				t.Error("z.png lost its registry row; only the deleted match's files should go")
			}
		})
	}
}
