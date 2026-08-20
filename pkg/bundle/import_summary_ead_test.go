package bundle_test

import (
	"testing"

	"recall/pkg/bundle"
	"recall/pkg/db/dbtest"
)

// db.SummaryRow carries no json tags, so every bundle already on disk spells the
// player's E/A/D with the field names that build had: PerfElimTotal and
// friends. Reading one of those with today's names would import 21 eliminations
// as 0 — a silent, total loss of the numbers on every summary screenshot in a
// backup, with nothing on screen to say it happened.
//
// Unlike the pre-v3 rank readings, these values ARE trustworthy: same integers,
// different key. So they are adopted, not dropped.
func TestImport_AdoptsTheOldEADKeysFromAPreV4Bundle(t *testing.T) {
	payload := zipParts(t, bundleParts{
		manifest: map[string]any{
			"schema": bundleSchemaV1, "recall_version": seededVersion,
			"match_count": 1, "screenshot_count": 1,
			"screenshots": map[string]string{"a.png": "m1"},
		},
		data: map[string]any{
			"schema": dataSchemaV3,
			"summaries": []map[string]any{{
				"Filename": "a.png", "MatchKey": "m1", "Map": "ilios",
				"PerfElimTotal": 21, "PerfAssistsTotal": 9, "PerfDeathsTotal": 4,
				"PerfElimAvgPer10Min": 14.2,
			}},
		},
		shots: map[string][]byte{"a.png": []byte("png")},
	})

	dst := dbtest.New()
	if _, err := bundle.Import(dst, payload); err != nil {
		t.Fatalf("Import: %v", err)
	}
	if len(dst.Summaries) != 1 {
		t.Fatalf("summary rows = %d, want 1", len(dst.Summaries))
	}
	s := dst.Summaries[0]
	if s.Eliminations != 21 || s.Assists != 9 || s.Deaths != 4 {
		t.Errorf("E/A/D = %d/%d/%d, want 21/9/4 — the old bundle's numbers were dropped",
			s.Eliminations, s.Assists, s.Deaths)
	}
	if s.PerfElimAvgPer10Min != 14.2 {
		t.Errorf("per-10-min rate = %v, want 14.2", s.PerfElimAvgPer10Min)
	}
}

// A current bundle already spells them the new way, and the compat pass must
// not reach in and overwrite a real value with the absent legacy key's zero.
func TestImport_LeavesACurrentBundlesEADAlone(t *testing.T) {
	payload := zipParts(t, bundleParts{
		manifest: map[string]any{
			"schema": bundleSchemaV1, "recall_version": seededVersion,
			"match_count": 1, "screenshot_count": 1,
			"screenshots": map[string]string{"a.png": "m1"},
		},
		data: map[string]any{
			"schema": dataSchemaV4,
			"summaries": []map[string]any{{
				"Filename": "a.png", "MatchKey": "m1",
				"Eliminations": 21, "Assists": 9, "Deaths": 4,
			}},
		},
		shots: map[string][]byte{"a.png": []byte("png")},
	})

	dst := dbtest.New()
	if _, err := bundle.Import(dst, payload); err != nil {
		t.Fatalf("Import: %v", err)
	}
	if s := dst.Summaries[0]; s.Eliminations != 21 || s.Assists != 9 || s.Deaths != 4 {
		t.Errorf("E/A/D = %d/%d/%d, want 21/9/4", s.Eliminations, s.Assists, s.Deaths)
	}
}
