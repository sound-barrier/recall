package coach_test

import (
	"encoding/json"
	"os"
	"testing"

	"recall/pkg/coach"
)

// The SHARED table, the same file the frontend's render-markdown.test.ts
// reads. Two implementations of one grammar only stay honest if a single
// fixture pins them — a case added to the JSON fails whichever side has not
// caught up, which is the whole point of keeping it out of both suites.
func TestRenderMarkdown_MatchesTheSharedFixture(t *testing.T) {
	raw, err := os.ReadFile("testdata/markdown_cases.json")
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var table struct {
		Cases []struct {
			Name string `json:"name"`
			In   string `json:"in"`
			Out  string `json:"out"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &table); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	if len(table.Cases) < 20 {
		t.Fatalf("fixture has %d cases, want the full grammar", len(table.Cases))
	}
	for _, c := range table.Cases {
		t.Run(c.Name, func(t *testing.T) {
			if got := coach.RenderMarkdown(c.In); got != c.Out {
				t.Errorf("RenderMarkdown(%q)\n got %q\nwant %q", c.In, got, c.Out)
			}
		})
	}
}
