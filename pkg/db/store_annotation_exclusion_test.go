package db_test

import (
	"testing"

	"recall/pkg/db"
)

// Why a match doesn't count is a fact about the match, so it rides the
// annotation beside the note and the disruption sides — and both Store
// implementations have to carry it, or every app-layer test built on the
// Fake is testing a shape production does not have.
func TestStoreContract_AnnotationCarriesTheExclusionReason(t *testing.T) {
	const key = "match-2026-05-10T22-21-11"
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			mustNoErr(t, s.SetAnnotation(db.Annotation{
				MatchKey:        key,
				Note:            "placements, ignore the result",
				ExclusionReason: "placement",
			}))

			got, err := s.LoadAnnotations()
			mustNoErr(t, err)
			if got[key].ExclusionReason != "placement" {
				t.Errorf("ExclusionReason = %q, want placement", got[key].ExclusionReason)
			}

			// Clearing it is an ordinary edit — the row survives, the
			// reason does not, and the match counts again.
			mustNoErr(t, s.SetAnnotation(db.Annotation{MatchKey: key, Note: "placements, ignore the result"}))
			got, err = s.LoadAnnotations()
			mustNoErr(t, err)
			if got[key].ExclusionReason != "" {
				t.Errorf("ExclusionReason = %q after clearing, want empty", got[key].ExclusionReason)
			}
		})
	}
}
