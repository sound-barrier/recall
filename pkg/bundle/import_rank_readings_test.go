package bundle_test

import (
	"testing"

	"recall/pkg/bundle"
	"recall/pkg/db"
)

// db.RankRow carries no json tags, so a bundle written before the rank readings
// became nullable serialized them as plain ints: EVERY rank row wrote
// "RankProgress":0,"ChangePercent":0, including the ones that held 0 only
// because the caption was never read. Deserializing that into the pointers
// those fields are now would turn each fabricated zero into a confident
// measurement — exactly the carry-forward the store refuses to open an old
// database to prevent, arriving through the side door instead.
//
// An importer cannot tell the two apart in such a payload, so it must not try.
func TestImport_DropsRankReadingsFromAPreV3Bundle(t *testing.T) {
	zero := 0
	rows := []db.RankRow{{
		Filename: "r.png", MatchKey: "k1", Rank: "platinum", Level: 2,
		RankProgress: &zero, ChangePercent: &zero,
	}}

	got := bundle.DropPreV3RankReadings(bundle.ExportSchemaV2, rows)

	if got[0].RankProgress != nil || got[0].ChangePercent != nil {
		t.Errorf("progress=%v change=%v, want both nil — a pre-v3 bundle cannot say "+
			"whether those zeros were read or fabricated",
			got[0].RankProgress, got[0].ChangePercent)
	}
	// The rest of the row is real and must survive.
	if got[0].Rank != "platinum" || got[0].Level != 2 {
		t.Errorf("rank = %q %d, want platinum 2 — only the untrustworthy readings drop",
			got[0].Rank, got[0].Level)
	}
	// And the caller's slice must not be mutated underneath it.
	if rows[0].RankProgress == nil {
		t.Error("the input slice was mutated; the copy exists so a caller can still " +
			"see what the bundle actually contained")
	}
}

// A current bundle CAN express the distinction, so its readings are kept —
// including a genuine 0, which is the whole point of the pointer.
func TestImport_KeepsRankReadingsFromAV3Bundle(t *testing.T) {
	zero := 0
	rows := []db.RankRow{{
		Filename: "r.png", MatchKey: "k1", RankProgress: &zero, ChangePercent: &zero,
	}}

	got := bundle.DropPreV3RankReadings(bundle.ExportSchemaV3, rows)

	if got[0].RankProgress == nil || *got[0].RankProgress != 0 {
		t.Errorf("progress = %v, want a real 0 — v3 says the screenshot reported it",
			got[0].RankProgress)
	}
}
