package parser_test

import (
	"image"
	"sync"
	"testing"

	"recall/pkg/parser"
)

// recordingStubOCR is stubOCR plus a call log, so a test can assert which
// regions were (and were NOT) OCR'd.
func recordingStubOCR(t *testing.T, table map[string]string) *[]string {
	t.Helper()
	var mu sync.Mutex
	regions := &[]string{}
	original := *parser.RunTesseractFunc
	*parser.RunTesseractFunc = func(_ image.Image, _, name, _, _ string) (string, error) { //nolint:unparam // signature fixed by RunTesseractFunc
		mu.Lock()
		*regions = append(*regions, name)
		mu.Unlock()
		return table[name], nil
	}
	t.Cleanup(func() { *parser.RunTesseractFunc = original })
	return regions
}

// The 2026-07 UI's stylized division caption defeats the sparse pass: the
// numeral reads as a letter ("PLATINUM 5" → "PI ATINUM J", "GOLD 3" →
// "GOLD J") or corrupts the tier word ("GOLD 2" → "FOLD?"). All raw inputs
// below are real OCR output harvested from the bundle's debug dumps. A
// PSM-6 re-read of the same band recovers the caption; it must fire only
// when the sparse pass came back incomplete.
func TestParseRank_TierV2FallbackRecoversStylizedNumerals(t *testing.T) {
	cases := []struct {
		name, tier, v2 string
		wantRank       string
		wantLevel      int
	}{
		{"platinum numeral read as J", "PI ATINUM J||\\/ fi} RANK PROGRESS: 12%", "PLATINUM 5\nRANK PROGRESS: 12%", "platinum", 5},
		{"gold numeral read as J", "as OF||GOLD J||\\/ [i] RANK PROGRESS: 78%", "GOLD 3\nRANK PROGRESS: 78%", "gold", 3},
		{"tier word corrupted", "a||FOLD?||\\/ [i] RANK PROGRESS: 100%", "GOLD 2\nRANK PROGRESS: 100%", "gold", 2},
		{"both passes fail stays honest-empty", "a||F010 3||\\/ fi} RANK PROGRESS: 100%", "OF|IK|N G:1%", "", 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			stubOCR(t, map[string]string{"rank_tier": c.tier, "rank_tier_v2": c.v2})
			res, err := parser.ParseRank(tinyImage(), t.TempDir())
			if err != nil {
				t.Fatalf("ParseRank: %v", err)
			}
			if res.Rank != c.wantRank || res.Level != c.wantLevel {
				t.Errorf("rank/level = %q/%d, want %q/%d", res.Rank, res.Level, c.wantRank, c.wantLevel)
			}
			if !res.RankScreen {
				t.Error("parseRank must set the RankScreen classification marker")
			}
		})
	}
}

// Every DEMOTION-stem chip maps to "demotion protection", on BOTH UI
// generations. This is deliberate conservatism, not laziness: old-UI OCR
// can lose everything after the stem (a real corpus capture reads
// "< DEMOTION || a || Pe"), so a text split like "PROTEC present ⇒
// protection, else bare demotion" inverts the old UI's meaning exactly
// when truncation bites. The 2026-07 UI's bare "DEMOTION" chip has no
// capture yet proving it means demoted-this-game rather than a relabel
// (the one fixture sat at 52% progress — nothing demoted). If such a
// capture lands, split THEN, with the fixture as the RED test.
func TestParseRank_DemotionStemAlwaysMapsToProtection(t *testing.T) {
	cases := []struct {
		name, chips string
	}{
		{"old UI, tail truncated to nothing", "x DEFEAT||> CONSOLATION < DEMOTION||a |||Pe"},
		{"old UI, PROTEC survives", "X DEFEAT (©) DEMOTION PROTEC"},
		{"2026-07 bare demotion chip", "x DEFEAT || € DEMOTION € LOSING TREND"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			stubOCR(t, map[string]string{"rank_modifiers": c.chips})
			res, err := parser.ParseRank(tinyImage(), t.TempDir())
			if err != nil {
				t.Fatalf("ParseRank: %v", err)
			}
			got := map[string]bool{}
			for _, m := range res.Modifiers {
				got[m] = true
			}
			if !got["demotion protection"] {
				t.Errorf("modifiers %v must include \"demotion protection\"", res.Modifiers)
			}
			if got["demotion"] {
				t.Errorf("modifiers %v must not mint an unproven \"demotion\" value", res.Modifiers)
			}
		})
	}
}

// A clean sparse-pass read must NOT trigger the fallback — old-UI captures
// keep their single-read behavior byte-for-byte (no old golden has level 0,
// so the fallback can never fire on the existing corpus).
func TestParseRank_TierV2NotConsultedWhenSparseSucceeds(t *testing.T) {
	regions := recordingStubOCR(t, map[string]string{
		"rank_tier": "GOLD 2\nRANK PROGRESS: 52%",
	})
	res, err := parser.ParseRank(tinyImage(), t.TempDir())
	if err != nil {
		t.Fatalf("ParseRank: %v", err)
	}
	if res.Rank != "gold" || res.Level != 2 {
		t.Fatalf("rank/level = %q/%d, want gold/2", res.Rank, res.Level)
	}
	for _, r := range *regions {
		if r == "rank_tier_v2" {
			t.Error("fallback band must not be OCR'd when the sparse pass read a complete tier")
		}
	}
}
