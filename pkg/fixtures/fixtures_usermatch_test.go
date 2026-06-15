package fixtures_test

import (
	"testing"

	"recall/pkg/fixtures"
)

// The seeded corpus must exercise all three provenance states so a dev can
// eyeball OCR, Edited, and Manual matches after `make seed-dev`.
func TestGenerateMatchFixture_SeedsUserMatchVariants(t *testing.T) {
	fx := fixtures.GenerateMatchFixture(120, 7, "flex")
	if len(fx.UserData) == 0 {
		t.Fatal("expected user-data variants, got none")
	}

	ocrKeys := make(map[string]bool, len(fx.Summaries))
	for _, s := range fx.Summaries {
		ocrKeys[s.MatchKey] = true
	}

	var edited, manual int
	for _, ud := range fx.UserData {
		if ocrKeys[ud.MatchKey] {
			edited++ // override on an existing screenshot-backed match → ocr_edited
		} else {
			manual++ // no screenshot row behind the key → manual
		}
	}
	if edited == 0 {
		t.Error("expected at least one edited (ocr_edited) override")
	}
	if manual == 0 {
		t.Error("expected at least one manual match")
	}

	// Every manual match gets queue + play-mode seeds keyed on its fresh key,
	// so it reads like a real match (not stuck on "Not set").
	queued := make(map[string]bool, len(fx.Queues))
	for _, q := range fx.Queues {
		queued[q.MatchKey] = true
	}
	for _, ud := range fx.UserData {
		if !ocrKeys[ud.MatchKey] && !queued[ud.MatchKey] {
			t.Errorf("manual match %s is missing a queue seed", ud.MatchKey)
		}
	}
}
