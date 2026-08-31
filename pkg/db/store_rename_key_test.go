package db_test

import (
	"testing"

	"recall/pkg/db"
)

// Resolving an ambiguous screenshot RENAMES the match — and match_key is the
// identity in 20-odd tables with no foreign key declaring it, so a rename
// that moves only the five parent rows strands everything else.
//
// This is reachable from the shipped UI: an ambiguous match with a readable
// map renders as an ordinary row, and the detail panel offers pin, annotate
// and moments on any record. The user pins it, then attaches the screenshot
// — and the pin is on a key nothing will ever look up again.
//
// The user_match_data half is worse than stranded. An override row with no
// screenshot row is exactly SynthesizeManualMatches' definition of a manual
// match, so the orphan comes back as a permanent blank match in the list and
// in every Trends aggregate.
func TestStoreContract_ResolvingAnAmbiguousMatchCarriesItsSidecars(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			const ambiguous = "ambiguous-c2hvdA"
			const resolved = "match-2026-08-18T20-10-00"

			mustNoErr(t, s.UpsertSummary(db.SummaryRow{
				Filename: "shot.png", MatchKey: ambiguous, Map: "rialto",
			}))
			mustNoErr(t, s.ApplyAmbiguity("shot.png", []db.AmbiguousCandidate{
				{MatchKey: resolved, DistanceSeconds: 40},
			}))
			// Everything the panel lets you do to a row.
			mustNoErr(t, s.PinMatch(ambiguous))
			mustNoErr(t, s.AcknowledgeReferenceGap(ambiguous))
			mustNoErr(t, s.SetAnnotation(db.Annotation{
				MatchKey: ambiguous, Note: "held the choke", Tags: []string{"positioning"},
			}))
			mustNoErr(t, s.SetReview(ambiguous, "self"))
			mustNoErr(t, s.SetMatchQueue(ambiguous, "role"))
			mustNoErr(t, s.UpsertUserMatchData(db.UserMatchData{
				MatchKey: ambiguous, Damage: func() *int { n := 9000; return &n }(),
			}))

			moved, err := s.ResolveAmbiguous("shot.png", ambiguous, resolved)
			mustNoErr(t, err)
			if !moved {
				t.Fatal("ResolveAmbiguous reported nothing to move")
			}

			assertSidecarsMoved(t, s, resolved)
			assertNothingLeftBehind(t, s, ambiguous, resolved)
		})
	}
}

// Everything the detail panel lets you put on a row follows the rename.
func assertSidecarsMoved(t *testing.T, s db.Store, resolved string) {
	t.Helper()
	pinned, err := s.LoadPinnedKeys()
	mustNoErr(t, err)
	if !pinned[resolved] {
		t.Error("the pin was left on the dead key")
	}
	acked, err := s.LoadAcknowledgedReferenceGaps()
	mustNoErr(t, err)
	if !acked[resolved] {
		t.Error("the reference-gap ack was left on the dead key")
	}
	notes, err := s.LoadAnnotations()
	mustNoErr(t, err)
	if notes[resolved].Note != "held the choke" {
		t.Errorf("the annotation was left behind: %+v", notes[resolved])
	}
	reviews, err := s.LoadReviews()
	mustNoErr(t, err)
	if _, ok := reviews[resolved]; !ok {
		t.Error("the reviewed mark was left on the dead key")
	}
	queues, err := s.LoadMatchQueues()
	mustNoErr(t, err)
	if queues[resolved].QueueType == "" {
		t.Error("the queue tag was left on the dead key")
	}
}

// An override row with no screenshot row is exactly what
// SynthesizeManualMatches looks for, so an orphan here does not merely sit
// there — it comes back as a permanent blank match in every aggregate.
func assertNothingLeftBehind(t *testing.T, s db.Store, ambiguous, resolved string) {
	t.Helper()
	overrides, err := s.LoadAllUserMatchData()
	mustNoErr(t, err)
	if _, ghost := overrides[ambiguous]; ghost {
		t.Error("an override row survived on the dead key — it will read as a manual match")
	}
	if _, ok := overrides[resolved]; !ok {
		t.Error("the override did not follow the match")
	}
}

// filename is a BASENAME, and screenshots_dirs accumulates a row every time
// the user re-points the folder. So the same name really can arrive from two
// folders, and it is two screenshots — not one.
//
// Keyed on the basename alone this was wrong twice over: on a normal parse
// the second folder's file counted as already parsed and was silently never
// ingested, and on Re-parse All it overwrote the FIRST folder's row wholesale
// — match_key re-pointed, map and result replaced, the dir id rewritten so
// the old thumbnail 404s. No error, no log.
func TestStoreContract_SameNameInTwoFoldersIsTwoScreenshots(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			oneID, err := s.EnsureScreenshotsDir("/captures/one")
			mustNoErr(t, err)
			twoID, err := s.EnsureScreenshotsDir("/captures/two")
			mustNoErr(t, err)

			mustNoErr(t, s.UpsertSummary(db.SummaryRow{
				Filename: "shot.png", MatchKey: "match-one", Map: "rialto",
				ScreenshotsDirID: oneID,
			}))
			mustNoErr(t, s.UpsertSummary(db.SummaryRow{
				Filename: "shot.png", MatchKey: "match-two", Map: "ilios",
				ScreenshotsDirID: twoID,
			}))

			// Both survive, each under its own folder.
			all, err := s.LoadAll()
			mustNoErr(t, err)
			rows := all.Summaries
			byKey := map[string]db.SummaryRow{}
			for _, r := range rows {
				byKey[r.MatchKey] = r
			}
			if len(byKey) != 2 {
				t.Fatalf("stored %d rows, want both folders' screenshots: %+v", len(byKey), rows)
			}
			if byKey["match-one"].Map != "rialto" || byKey["match-two"].Map != "ilios" {
				t.Errorf("one folder's row overwrote the other: %+v", byKey)
			}

			// And the skip set is per-folder, so neither hides the other.
			first, err := s.LoadFilenamesForDir(oneID)
			mustNoErr(t, err)
			second, err := s.LoadFilenamesForDir(twoID)
			mustNoErr(t, err)
			if !first["shot.png"] || !second["shot.png"] {
				t.Errorf("per-folder skip sets = %v / %v, want each to know its own", first, second)
			}
			third, err := s.LoadFilenamesForDir(oneID + twoID + 1)
			mustNoErr(t, err)
			if third["shot.png"] {
				t.Error("a third folder's skip set claims a file it has never seen")
			}
		})
	}
}
