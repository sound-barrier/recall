package aggregate_test

import (
	"slices"
	"testing"

	"recall/pkg/aggregate"
	"recall/pkg/db"
	"recall/pkg/match"
	"recall/pkg/parser"
)

func ocrRecord(key string) match.Record {
	return match.Record{
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

	recs := []match.Record{rec}
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

	recs := []match.Record{rec}
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

// derivedField names one override scalar, the derived field it drives, and
// the seed that puts both in a pre-edit state — one row per re-derivation
// rule in rederiveEditedFields.
type derivedField struct {
	name     string
	seed     func(*parser.MatchResult)
	override func(*string) db.UserMatchData
	readOut  func(parser.MatchResult) string
}

// Clearing an override back to "" must clear the field it derives too. The
// override is the ONLY source once applyScalarOverrides wipes MapRaw /
// HeroRaw, so a surviving GameMode / Role asserts a game mode with no map
// (or a role with no hero) — the dossier chip and the mode filter both read
// the derived field, so the match keeps showing and filtering as Control
// after the user cleared its map.
func TestAttachUserData_ClearedOverrideClearsItsDerivedField(t *testing.T) {
	for _, f := range []derivedField{
		{
			name: "cleared map clears game mode",
			seed: func(d *parser.MatchResult) {
				d.Map, d.MapRaw = "Lijiang Tower", "Lijiane Tovver"
				d.GameMode = parser.MapGameMode("Lijiang Tower")
			},
			override: func(s *string) db.UserMatchData { return db.UserMatchData{MatchKey: "match-1", Map: s} },
			readOut:  func(d parser.MatchResult) string { return d.GameMode },
		},
		{
			name: "cleared hero clears role",
			seed: func(d *parser.MatchResult) {
				d.Hero, d.HeroRaw = "ana", "an4"
				d.Role = parser.HeroRole("ana")
			},
			override: func(s *string) db.UserMatchData { return db.UserMatchData{MatchKey: "match-1", Hero: s} },
			readOut:  func(d parser.MatchResult) string { return d.Role },
		},
	} {
		t.Run(f.name, func(t *testing.T) {
			rec := ocrRecord("match-1")
			f.seed(&rec.Data)
			if f.readOut(rec.Data) == "" {
				t.Fatal("precondition: the derived field must start non-empty")
			}
			cleared := ""
			recs := []match.Record{rec}
			aggregate.AttachUserData(recs, map[string]db.UserMatchData{"match-1": f.override(&cleared)})

			if got := f.readOut(recs[0].Data); got != "" {
				t.Errorf("derived field = %q, want it cleared with the override", got)
			}
		})
	}
}

// A manual match (no screenshot rows) is SourceManual with no EditedFields — the
// badge conveys provenance — and falls back to UpdatedAt for ParsedAt.
func TestAttachUserData_ManualHasNoEditedFields(t *testing.T) {
	manual := match.Record{MatchKey: "match-x", SourceFiles: []string{}, Source: match.SourceManual}
	won := "victory"
	ud := map[string]db.UserMatchData{"match-x": {
		MatchKey: "match-x", Result: &won, UpdatedAt: "2026-06-15T00:00:00Z",
	}}

	recs := []match.Record{manual}
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

	recs := []match.Record{rec}
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
	recs := []match.Record{ocrRecord("match-b")}
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

// A match a coach's review created is not a match the player hand-entered,
// and the difference is not cosmetic: the coach typed the result from a
// replay, so it must not be counted into the player's own record the way a
// manual entry is. The provenance is derived from the key rather than stored,
// because the key already says it.
func TestSynthesizeManualMatches_ReplayKeysCarryTheirOwnProvenance(t *testing.T) {
	ud := map[string]db.UserMatchData{
		"replay-A1B2C3":             {MatchKey: "replay-A1B2C3"},
		"match-2026-01-01T00-00-00": {MatchKey: "match-2026-01-01T00-00-00"},
	}

	out := aggregate.SynthesizeManualMatches(nil, ud)

	got := map[string]string{}
	for _, r := range out {
		got[r.MatchKey] = r.Source
	}
	if got["replay-A1B2C3"] != match.SourceReplay {
		t.Errorf("replay key Source = %q, want %q", got["replay-A1B2C3"], match.SourceReplay)
	}
	if got["match-2026-01-01T00-00-00"] != match.SourceManual {
		t.Errorf("hand-entered key Source = %q, want %q", got["match-2026-01-01T00-00-00"], match.SourceManual)
	}
}

// A percentile is a reading taken against a SPECIFIC rank, so correcting that
// rank invalidates it — the same rule that clears MapRaw when the map is
// corrected. Not clearing it produces a plausible lie: "diamond 5 · higher
// ranked than 57% of players", where the 57% was read off a platinum 2 screen
// and nothing on screen says so.
//
// Cleared rather than recomputed: there is no published distribution to
// recompute from. That absence is why the Elo population card was deleted in
// the first place, and inventing a replacement here would be worse than
// showing nothing.
func TestAttachUserData_RankOverrideClearsTheMeasuredPercentile(t *testing.T) {
	for _, tc := range []struct {
		name string
		ud   db.UserMatchData
	}{
		{"tier corrected", db.UserMatchData{MatchKey: "match-1", Rank: new("diamond")}},
		{"division corrected", db.UserMatchData{MatchKey: "match-1", Level: new(5)}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			pct := 57
			rec := ocrRecord("match-1")
			rec.Data.Rank, rec.Data.Level, rec.Data.RankPercentile = "platinum", 2, &pct

			recs := []match.Record{rec}
			aggregate.AttachUserData(recs, map[string]db.UserMatchData{"match-1": tc.ud})

			if recs[0].Data.RankPercentile != nil {
				t.Errorf("percentile = %d after the rank was corrected, want nil — it was "+
					"measured against the rank the screenshot showed",
					*recs[0].Data.RankPercentile)
			}
		})
	}
}

// An edit that does not touch the rank leaves the reading alone.
func TestAttachUserData_UnrelatedOverrideKeepsThePercentile(t *testing.T) {
	pct := 57
	rec := ocrRecord("match-1")
	rec.Data.Rank, rec.Data.Level, rec.Data.RankPercentile = "platinum", 2, &pct

	recs := []match.Record{rec}
	aggregate.AttachUserData(recs, map[string]db.UserMatchData{
		"match-1": {MatchKey: "match-1", Map: new("ilios")},
	})

	if recs[0].Data.RankPercentile == nil || *recs[0].Data.RankPercentile != 57 {
		t.Error("a map correction dropped the rank percentile")
	}
}
