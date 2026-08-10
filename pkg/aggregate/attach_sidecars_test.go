package aggregate_test

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"

	"recall/pkg/aggregate"
	"recall/pkg/db"
	"recall/pkg/match"
	"recall/pkg/parser"
)

// AttachReviews writes the review status onto the matching record and leaves a
// non-matching record untouched (the attach branch, distinct from the
// already-covered empty-map no-op).
func TestAttachReviews_SetsStatusOnMatchingKeyOnly(t *testing.T) {
	recs := []match.Record{{MatchKey: "match-1"}, {MatchKey: "match-2"}}
	aggregate.AttachReviews(recs, map[string]db.ReviewState{
		"match-1": {ReviewedBy: "self", ReviewedAt: "2026-06-20T00:00:00Z"},
	})

	if recs[0].ReviewedBy != "self" || recs[0].ReviewedAt != "2026-06-20T00:00:00Z" {
		t.Errorf("recs[0] review = %q/%q, want set", recs[0].ReviewedBy, recs[0].ReviewedAt)
	}
	if recs[1].ReviewedBy != "" {
		t.Errorf("recs[1].ReviewedBy = %q, want untouched", recs[1].ReviewedBy)
	}
}

// AttachPlayModes is pure-override: PlayMode is set ONLY from the aux row, with
// no fallback inference.
func TestAttachPlayModes_OverridesFromAuxRow(t *testing.T) {
	recs := []match.Record{{MatchKey: "match-1"}}
	aggregate.AttachPlayModes(recs, map[string]db.PlayModeState{
		"match-1": {PlayMode: "competitive"},
	})

	if recs[0].PlayMode != "competitive" {
		t.Errorf("PlayMode = %q, want competitive", recs[0].PlayMode)
	}
}

// AttachHidden flips the soft-delete flag only for keys in the set.
func TestAttachHidden_FlipsOnlyListedKeys(t *testing.T) {
	recs := []match.Record{{MatchKey: "match-1"}, {MatchKey: "match-2"}}
	aggregate.AttachHidden(recs, map[string]bool{"match-2": true})

	if recs[0].Hidden {
		t.Error("recs[0].Hidden = true, want false")
	}
	if !recs[1].Hidden {
		t.Error("recs[1].Hidden = false, want true")
	}
}

// AttachAnnotations grafts the full annotation (scalars + member/tag lists) onto
// the matching record.
func TestAttachAnnotations_GraftsFullAnnotation(t *testing.T) {
	recs := []match.Record{{MatchKey: "match-1"}}
	aggregate.AttachAnnotations(recs, map[string]db.Annotation{
		"match-1": {
			MatchKey:    "match-1",
			Leavers:     []string{"self"},
			Throwers:    []string{"team", "enemy"},
			Note:        "threw round 1",
			ReplayCode:  "A1B2C3",
			Members:     []string{"ally#1234"},
			Tags:        []string{"tilt"},
			AnnotatedAt: "2026-06-20T00:00:00Z",
		},
	})

	a := recs[0].Annotation
	if a == nil {
		t.Fatal("Annotation = nil, want grafted")
	}
	if a.Note != "threw round 1" || a.ReplayCode != "A1B2C3" || a.AnnotatedAt != "2026-06-20T00:00:00Z" {
		t.Errorf("annotation scalars = %+v, want grafted", a)
	}
	if !slices.Equal(a.Leavers, []string{"self"}) || !slices.Equal(a.Throwers, []string{"team", "enemy"}) {
		t.Errorf("disruption sides = leavers %v / throwers %v, want grafted", a.Leavers, a.Throwers)
	}
	if !slices.Equal(a.Members, []string{"ally#1234"}) || !slices.Equal(a.Tags, []string{"tilt"}) {
		t.Errorf("annotation lists = members %v / tags %v", a.Members, a.Tags)
	}
}

// A non-empty annotation map that lacks a record's key leaves that record
// unannotated (the present-but-absent branch).
func TestAttachAnnotations_UnannotatedStaysNil(t *testing.T) {
	recs := []match.Record{{MatchKey: "match-1"}}
	aggregate.AttachAnnotations(recs, map[string]db.Annotation{"other": {MatchKey: "other"}})

	if recs[0].Annotation != nil {
		t.Errorf("Annotation = %+v, want nil for unannotated record", recs[0].Annotation)
	}
}

// A heroes-LIST override replaces the OCR roster wholesale, position 0 leading
// regardless of input order, carrying percent/play-time through. Covers
// userHeroesToPlays' stable position sort + pointer-deref.
func TestAttachUserData_HeroesListOverrideReplacesRosterPositionOrdered(t *testing.T) {
	rec := ocrRecord("match-1")
	rec.Data.HeroesPlayed = []parser.HeroPlay{{Hero: "junkrat"}}
	pct := 60
	dur := "8:30"
	ud := map[string]db.UserMatchData{"match-1": {
		MatchKey: "match-1",
		Heroes: []db.UserMatchHero{
			{Hero: "ana", Position: 1},
			{Hero: "genji", Position: 0, PercentPlayed: &pct, PlayTime: &dur},
		},
	}}

	recs := []match.Record{rec}
	aggregate.AttachUserData(recs, ud)

	hp := recs[0].Data.HeroesPlayed
	if len(hp) != 2 || hp[0].Hero != "genji" || hp[1].Hero != "ana" {
		t.Fatalf("HeroesPlayed = %+v, want [genji, ana] position-ordered", hp)
	}
	if hp[0].PercentPlayed != 60 || hp[0].PlayTime != "8:30" {
		t.Errorf("primary play = %d%%/%q, want percent/play-time carried", hp[0].PercentPlayed, hp[0].PlayTime)
	}
	if !slices.Contains(recs[0].EditedFields, "data.heroes_played") {
		t.Errorf("EditedFields = %v, want data.heroes_played", recs[0].EditedFields)
	}
}

// A per-hero SR override overlays onto data.sr (covers userSRToParser).
func TestAttachUserData_SROverrideConverts(t *testing.T) {
	rec := ocrRecord("match-1")
	ud := map[string]db.UserMatchData{"match-1": {
		MatchKey: "match-1",
		SR:       []db.HeroSR{{Hero: "ana", SR: 3200, Change: 25}},
	}}

	recs := []match.Record{rec}
	aggregate.AttachUserData(recs, ud)

	got := recs[0].Data.SR
	if len(got) != 1 || got[0].Hero != "ana" || got[0].SR != 3200 || got[0].Change != 25 {
		t.Errorf("SR = %+v, want [{ana 3200 25}]", got)
	}
	if !slices.Contains(recs[0].EditedFields, "data.sr") {
		t.Errorf("EditedFields = %v, want data.sr", recs[0].EditedFields)
	}
}

// MatchKey threads the per-key annotation / hidden / review sidecars
// through attachMatchSidecars, and folds an "unknown"-type screenshot for the
// same key via unknownToView (its filename joins the source-file union).
func TestAggregateMatchKey_AttachesSidecarsAndFoldsUnknown(t *testing.T) {
	snap := db.Screenshots{
		Summaries: []db.SummaryRow{{ID: 1, Filename: "s.png", MatchKey: "m1", Map: "rialto", Result: "victory"}},
		Unknowns:  []db.UnknownRow{{ID: 1, Filename: "u.png", MatchKey: "m1"}},
	}
	annos := map[string]db.Annotation{"m1": {MatchKey: "m1", Note: "clutch"}}
	hidden := map[string]bool{"m1": true}
	reviews := map[string]db.ReviewState{"m1": {ReviewedBy: "self", ReviewedAt: "2026-06-20T00:00:00Z"}}

	rec, ok := aggregate.MatchKey("m1", snap, aggregate.Sidecars{Annotations: annos, Hidden: hidden, Reviews: reviews})
	if !ok {
		t.Fatal("MatchKey ok=false for an existing key")
	}
	if rec.Annotation == nil || rec.Annotation.Note != "clutch" {
		t.Errorf("Annotation = %+v, want note clutch", rec.Annotation)
	}
	if !rec.Hidden {
		t.Error("Hidden = false, want true")
	}
	if rec.ReviewedBy != "self" {
		t.Errorf("ReviewedBy = %q, want self", rec.ReviewedBy)
	}
	if !slices.Contains(rec.SourceFiles, "u.png") {
		t.Errorf("SourceFiles = %v, want to include the unknown u.png", rec.SourceFiles)
	}
}

// The candidate Reason is derived from distance: beyond the 30-min EAD
// cap a candidate can only come from the duplicate sweep; at or below
// it, the reason stays empty (window / EAD ambiguity).
func TestAttachAmbiguity_DerivesDuplicateReasonFromDistance(t *testing.T) {
	sentinel := match.NewAmbiguousMatchKey("dup.png").String()
	recs := []match.Record{
		{MatchKey: sentinel, SourceFiles: []string{"dup.png"}},
		{MatchKey: "match-orig", SourceFiles: []string{"orig.png"}},
	}
	aggregate.AttachAmbiguity(recs, map[string][]db.AmbiguousCandidate{
		"dup.png": {
			{MatchKey: "match-orig", DistanceSeconds: 11321},
			{MatchKey: "match-other", DistanceSeconds: 720},
		},
	})
	if len(recs[0].Candidates) != 2 {
		t.Fatalf("expected 2 candidates, got %+v", recs[0].Candidates)
	}
	if got := recs[0].Candidates[0].Reason; got != "duplicate_stats" {
		t.Errorf("11321s candidate reason = %q, want duplicate_stats", got)
	}
	if got := recs[0].Candidates[1].Reason; got != "" {
		t.Errorf("720s candidate reason = %q, want empty", got)
	}
}

// The single-key aggregate path (attachMatchSidecars via
// MatchKey) derives the same reason — pins both candidate-
// building sites.
func TestAggregateMatchKey_DerivesDuplicateReasonFromDistance(t *testing.T) {
	sentinel := match.NewAmbiguousMatchKey("dup.png").String()
	snap := db.Screenshots{
		Teams: []db.TeamsRow{{Filename: "dup.png", MatchKey: sentinel, Eliminations: 1}},
		AmbiguousCandidates: map[string][]db.AmbiguousCandidate{
			"dup.png": {{MatchKey: "match-orig", DistanceSeconds: 11321}},
		},
	}
	rec, ok := aggregate.MatchKey(sentinel, snap, aggregate.Sidecars{})
	if !ok {
		t.Fatal("expected the sentinel record to aggregate")
	}
	if len(rec.Candidates) != 1 || rec.Candidates[0].Reason != "duplicate_stats" {
		t.Errorf("candidates = %+v, want one with reason duplicate_stats", rec.Candidates)
	}
}

// The OpenAPI contract marks `leavers` and `throwers` required, so they must
// reach the wire as `[]` when unset. Go marshals a nil slice as `null`, which
// violates `type: array` — schemathesis's response_schema_conformance catches
// it on GET /matches, GET /matches/{key}, and POST /matches.
func TestAttachAnnotations_SidesMarshalAsEmptyArraysNotNull(t *testing.T) {
	recs := []match.Record{{MatchKey: "match-1"}}
	aggregate.AttachAnnotations(recs, map[string]db.Annotation{
		"match-1": {MatchKey: "match-1", Note: "no sides tagged"},
	})

	blob, err := json.Marshal(recs[0].Annotation)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	for _, field := range []string{`"leavers":[]`, `"throwers":[]`} {
		if !strings.Contains(string(blob), field) {
			t.Errorf("annotation JSON = %s, want %s (nil slices marshal as null)", blob, field)
		}
	}
}
