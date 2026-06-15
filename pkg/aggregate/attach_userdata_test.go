package aggregate_test

import (
	"slices"
	"testing"

	"recall/pkg/aggregate"
	"recall/pkg/db"
	"recall/pkg/match"
	"recall/pkg/parser"
)

func ocrRecord(key string) match.MatchRecord {
	return match.MatchRecord{
		MatchKey:    key,
		SourceFiles: []string{key + ".png"},
		Source:      match.SourceOCR,
	}
}

// A non-nil override scalar wins over the OCR value, and an explicit 0 is a real
// edit (not "unset"): the record flips to ocr_edited and records the path.
func TestAttachUserData_ScalarOverrideWinsIncludingExplicitZero(t *testing.T) {
	rec := ocrRecord("match-1")
	rec.Data.Damage = 9001
	zero := 0
	ud := map[string]db.UserMatchData{"match-1": {MatchKey: "match-1", Damage: &zero}}

	recs := []match.MatchRecord{rec}
	aggregate.AttachUserData(recs, ud)

	if recs[0].Data.Damage != 0 {
		t.Errorf("Damage = %d, want explicit 0 override", recs[0].Data.Damage)
	}
	if recs[0].Source != match.SourceOCREdited {
		t.Errorf("Source = %q, want %q", recs[0].Source, match.SourceOCREdited)
	}
	if !slices.Contains(recs[0].EditedFields, "data.damage") {
		t.Errorf("EditedFields = %v, want to contain data.damage", recs[0].EditedFields)
	}
}

// Editing the hero re-derives Role from the NEW hero (derived fields are never
// stored, so the stale OCR role must not survive).
func TestAttachUserData_EditedHeroReDerivesRole(t *testing.T) {
	rec := ocrRecord("match-1")
	rec.Data.Hero = "genji"
	rec.Data.Role = parser.HeroRole("genji")
	newHero := "ana"
	ud := map[string]db.UserMatchData{"match-1": {MatchKey: "match-1", Hero: &newHero}}

	recs := []match.MatchRecord{rec}
	aggregate.AttachUserData(recs, ud)

	wantRole := parser.HeroRole("ana")
	if wantRole == "" {
		t.Fatal("precondition: ana must resolve to a role")
	}
	if recs[0].Data.Role != wantRole {
		t.Errorf("Role = %q, want re-derived %q", recs[0].Data.Role, wantRole)
	}
	if recs[0].Data.Hero != "ana" {
		t.Errorf("Hero = %q, want ana", recs[0].Data.Hero)
	}
}

// A manual match (no screenshot rows) is SourceManual with no EditedFields — the
// badge conveys provenance — and falls back to UpdatedAt for ParsedAt.
func TestAttachUserData_ManualHasNoEditedFields(t *testing.T) {
	manual := match.MatchRecord{MatchKey: "match-x", SourceFiles: []string{}, Source: match.SourceManual}
	won := "victory"
	ud := map[string]db.UserMatchData{"match-x": {
		MatchKey: "match-x", Result: &won, UpdatedAt: "2026-06-15T00:00:00Z",
	}}

	recs := []match.MatchRecord{manual}
	aggregate.AttachUserData(recs, ud)

	if recs[0].Source != match.SourceManual {
		t.Errorf("Source = %q, want manual", recs[0].Source)
	}
	if len(recs[0].EditedFields) != 0 {
		t.Errorf("EditedFields = %v, want empty for manual", recs[0].EditedFields)
	}
	if recs[0].Data.Result != "victory" {
		t.Errorf("Result = %q, want victory", recs[0].Data.Result)
	}
	if recs[0].ParsedAt != "2026-06-15T00:00:00Z" {
		t.Errorf("ParsedAt = %q, want UpdatedAt fallback", recs[0].ParsedAt)
	}
}

// A stat-cell override overlays onto the existing roster without replacing it —
// the two override dimensions stay independent.
func TestAttachUserData_StatOverlayKeepsRoster(t *testing.T) {
	rec := ocrRecord("match-1")
	rec.Data.HeroesPlayed = []parser.HeroPlay{{Hero: "junkrat", Stats: map[string]int{"hooks": 1}}}
	ud := map[string]db.UserMatchData{"match-1": {
		MatchKey:  "match-1",
		HeroStats: []db.UserMatchHeroStat{{Hero: "junkrat", StatKey: "rip_tire_kill", Value: 4}},
	}}

	recs := []match.MatchRecord{rec}
	aggregate.AttachUserData(recs, ud)

	hp := recs[0].Data.HeroesPlayed
	if len(hp) != 1 || hp[0].Hero != "junkrat" {
		t.Fatalf("roster changed: %+v", hp)
	}
	if hp[0].Stats["hooks"] != 1 || hp[0].Stats["rip_tire_kill"] != 4 {
		t.Errorf("stats = %v, want overlay onto existing hero", hp[0].Stats)
	}
	if !slices.Contains(recs[0].EditedFields, "data.heroes_played.junkrat.stats.rip_tire_kill") {
		t.Errorf("EditedFields = %v, want stat path", recs[0].EditedFields)
	}
}

// A user-data key with no screenshot-backed record becomes a synthesized manual
// shell; the result re-sorts by match_key so manual + OCR interleave.
func TestSynthesizeManualMatches_AppendsShellForKeylessUserData(t *testing.T) {
	recs := []match.MatchRecord{ocrRecord("match-b")}
	ud := map[string]db.UserMatchData{
		"match-b": {MatchKey: "match-b"}, // already present as OCR
		"match-a": {MatchKey: "match-a"}, // manual-only
	}

	out := aggregate.SynthesizeManualMatches(recs, ud)

	if len(out) != 2 {
		t.Fatalf("len = %d, want 2 (ocr + 1 synthesized)", len(out))
	}
	if out[0].MatchKey != "match-a" || out[0].Source != match.SourceManual {
		t.Errorf("out[0] = %+v, want synthesized manual match-a", out[0])
	}
	if len(out[0].SourceFiles) != 0 {
		t.Errorf("manual shell SourceFiles = %v, want empty", out[0].SourceFiles)
	}
	if out[1].MatchKey != "match-b" || out[1].Source != match.SourceOCR {
		t.Errorf("out[1] = %+v, want untouched ocr match-b", out[1])
	}
}
