package match_test

import (
	"encoding/json"
	"os"
	"testing"

	"recall/pkg/match"
)

// The cases live in testdata/replay_code_cases.json rather than in this file
// because frontend/src/match/replay-code.test.ts reads the same fixture. A
// replay code is the only token a coach and a player derive the same match
// key from, on two installs and in two languages; a divergence between the
// implementations is silent and costs the note. One fixture, two readers, is
// the same arrangement that pins the markdown grammar.
type replayCodeCase struct {
	Name string `json:"name"`
	In   string `json:"in"`
	Want string `json:"want"`
	OK   bool   `json:"ok"`
}

func loadReplayCodeCases(t *testing.T) []replayCodeCase {
	t.Helper()
	raw, err := os.ReadFile("testdata/replay_code_cases.json")
	if err != nil {
		t.Fatalf("read shared fixture: %v", err)
	}
	var doc struct {
		Cases []replayCodeCase `json:"cases"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("decode shared fixture: %v", err)
	}
	if len(doc.Cases) == 0 {
		t.Fatal("shared fixture holds no cases")
	}
	return doc.Cases
}

func TestNormalizeReplayCode(t *testing.T) {
	for _, tc := range loadReplayCodeCases(t) {
		t.Run(tc.Name, func(t *testing.T) {
			got, ok := match.NormalizeReplayCode(tc.In)
			if ok != tc.OK {
				t.Fatalf("NormalizeReplayCode(%q) ok = %v, want %v", tc.In, ok, tc.OK)
			}
			if got != tc.Want {
				t.Errorf("NormalizeReplayCode(%q) = %q, want %q", tc.In, got, tc.Want)
			}
		})
	}
}

// A code that normalizes must stay put when normalized again — the store's
// startup pass relies on it to be a genuine no-op on its second run.
func TestNormalizeReplayCode_Idempotent(t *testing.T) {
	for _, tc := range loadReplayCodeCases(t) {
		if !tc.OK {
			continue
		}
		twice, ok := match.NormalizeReplayCode(tc.Want)
		if !ok || twice != tc.Want {
			t.Errorf("re-normalizing %q gave (%q, %v), want (%q, true)", tc.Want, twice, ok, tc.Want)
		}
	}
}
