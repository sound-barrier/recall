package db_test

import (
	"slices"
	"testing"

	"recall/pkg/db"
)

// DeleteScreenshotRows is the store half of the Unknown tab's Dismiss:
// it removes ONE file's contribution to the corpus and reports which
// match keys that left empty, so the caller can decide the match's fate.
// The contract these tests pin — for both implementations — is what makes
// Dismiss safe: siblings survive, the dedup registry is never touched,
// and only genuinely emptied keys are handed back for the full wipe.

func TestStoreContract_DeleteScreenshotRows_RemovesOnlyThatFilesRows(t *testing.T) {
	const key = "match-2026-05-10T22-21-11"
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			mustNoErr(t, s.UpsertSummary(db.SummaryRow{Filename: "a.png", MatchKey: key}))
			mustNoErr(t, s.UpsertTeams(db.TeamsRow{Filename: "b.png", MatchKey: key}))

			orphans, err := s.DeleteScreenshotRows("a.png")
			mustNoErr(t, err)

			if len(orphans) != 0 {
				t.Errorf("orphans = %v, want none — b.png still carries the key", orphans)
			}
			names, err := s.LoadAllFilenames()
			mustNoErr(t, err)
			if names["a.png"] {
				t.Errorf("a.png still has parent rows after DeleteScreenshotRows")
			}
			if !names["b.png"] {
				t.Errorf("sibling b.png lost its rows; the match must survive minus the deleted file")
			}
		})
	}
}

func TestStoreContract_DeleteScreenshotRows_ReturnsOrphanedKeysSorted(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			// One file, two keys across tables (a re-parse drift shape):
			// both keys empty out, both come back, in deterministic order.
			mustNoErr(t, s.UpsertSummary(db.SummaryRow{Filename: "solo.png", MatchKey: "match-2026-05-02T10-00-00"}))
			mustNoErr(t, s.UpsertTeams(db.TeamsRow{Filename: "solo.png", MatchKey: "match-2026-05-01T09-00-00"}))

			orphans, err := s.DeleteScreenshotRows("solo.png")
			mustNoErr(t, err)

			want := []string{"match-2026-05-01T09-00-00", "match-2026-05-02T10-00-00"}
			if !slices.Equal(orphans, want) {
				t.Errorf("orphans = %v, want %v (sorted)", orphans, want)
			}
		})
	}
}

// Pins the dedup-registry invariant: ingested_files rows survive the
// delete. duplicate_of carries ON DELETE CASCADE, so removing a
// canonical's row would silently unregister every byte-identical copy —
// which would re-enter the pending set and resurrect the dismissed
// content under a filename the ignore list has never heard of.
func TestStoreContract_DeleteScreenshotRows_KeepsIngestedRegistration(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			mustNoErr(t, s.UpsertSummary(db.SummaryRow{Filename: "canon.png", MatchKey: "match-2026-05-03T11-00-00"}))
			mustNoErr(t, s.UpsertIngestedFile("canon.png", "hash-1", ""))
			mustNoErr(t, s.UpsertIngestedFile("copy.png", "hash-1", "canon.png"))

			_, err := s.DeleteScreenshotRows("canon.png")
			mustNoErr(t, err)

			reg, err := s.LoadIngestedFiles()
			mustNoErr(t, err)
			if _, ok := reg["canon.png"]; !ok {
				t.Errorf("canon.png left the dedup registry; its duplicates would re-parse")
			}
			if _, ok := reg["copy.png"]; !ok {
				t.Errorf("copy.png cascaded out of the dedup registry")
			}
		})
	}
}

func TestStoreContract_DeleteScreenshotRows_DropsTheFilesOwnCandidateSet(t *testing.T) {
	const sentinel = "ambiguous-cGVuZGluZy5wbmc"
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			mustNoErr(t, s.UpsertUnknown(db.UnknownRow{Filename: "pending.png", MatchKey: sentinel}))
			mustNoErr(t, s.ApplyAmbiguity("pending.png", []db.AmbiguousCandidate{
				{MatchKey: "match-20260101120000", DistanceSeconds: 90},
			}))

			orphans, err := s.DeleteScreenshotRows("pending.png")
			mustNoErr(t, err)

			if !slices.Contains(orphans, sentinel) {
				t.Errorf("orphans = %v, want the emptied sentinel %q", orphans, sentinel)
			}
			cands, err := s.LoadAmbiguousCandidatesFor("pending.png")
			mustNoErr(t, err)
			if len(cands) != 0 {
				t.Errorf("candidate set survived its screenshot: %+v", cands)
			}
		})
	}
}

// The dead-key invariant must hold INSIDE the delete's own transaction:
// candidates referencing a key the delete emptied go with it, so a crash
// before the caller's follow-up HardDeleteMatch can't leave a pending
// screenshot resolvable onto a dead key.
func TestStoreContract_DeleteScreenshotRows_DropsCandidatesReferencingAnEmptiedKey(t *testing.T) {
	const key = "match-20260101120000"
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			mustNoErr(t, s.UpsertSummary(db.SummaryRow{Filename: "solo.png", MatchKey: key}))
			mustNoErr(t, s.UpsertUnknown(db.UnknownRow{Filename: "pending.png", MatchKey: "ambiguous-cGVuZGluZy5wbmc"}))
			mustNoErr(t, s.ApplyAmbiguity("pending.png", []db.AmbiguousCandidate{
				{MatchKey: key, DistanceSeconds: 90},
			}))

			_, err := s.DeleteScreenshotRows("solo.png")
			mustNoErr(t, err)

			cands, err := s.LoadAmbiguousCandidatesFor("pending.png")
			mustNoErr(t, err)
			if len(cands) != 0 {
				t.Errorf("candidates still reference the emptied key: %+v", cands)
			}
		})
	}
}

func TestStoreContract_DeleteScreenshotRows_ClearsAllHeroesRegistration(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			mustNoErr(t, s.UpsertAllHeroesScreenshot("ah.png"))

			orphans, err := s.DeleteScreenshotRows("ah.png")
			mustNoErr(t, err)

			if len(orphans) != 0 {
				t.Errorf("orphans = %v, want none for a registry-only file", orphans)
			}
			ah, err := s.LoadAllHeroesFilenames()
			mustNoErr(t, err)
			if ah["ah.png"] {
				t.Errorf("all_heroes registration survived; the file would stay skip-listed")
			}
		})
	}
}

func TestStoreContract_DeleteScreenshotRows_IdempotentOnAbsentFilename(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			orphans, err := s.DeleteScreenshotRows("never-seen.png")
			mustNoErr(t, err)
			if len(orphans) != 0 {
				t.Errorf("orphans = %v, want none for an absent filename", orphans)
			}
		})
	}
}
