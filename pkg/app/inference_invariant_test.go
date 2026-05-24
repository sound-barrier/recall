package app

// Tests in this file lock the load-bearing invariant that the read-time
// inference helpers (inferSoleHeroPercent, inferResultFromRank) run on
// the way OUT of the DB — via GetMatchResults and scrapeReader — never
// inside the merge path that writes to the store.
//
// Why this matters: mergeMatchResult uses first-non-empty-wins for
// scalars. If inference fired before the merge, the inferred value
// would land in the DB, then a later SUMMARY screenshot's authoritative
// value (e.g. a `defeat` when the SR-delta inference picked `victory`)
// would lose to the already-stored inferred value. The current
// architecture sidesteps that by NEVER persisting inferred fields:
// the store always holds the raw OCR output, and inference is recomputed
// on every read.
//
// A future refactor that "helpfully" moves inference into the merge path
// to "avoid recomputing on every read" would silently corrupt match
// outcomes. These tests fail loudly in that case.

import (
	"testing"

	"recall/pkg/db"
	"recall/pkg/parser"
)

func TestInference_ResultFromRank_FiresAtReadTime(t *testing.T) {
	// A rank screen whose VICTORY/DEFEAT banner OCR missed (Result == "")
	// but whose SR row has a positive Change. inferResultFromRank should
	// fill Result with "victory" when GetMatchResults runs.
	fs := &fakeStore{
		rows: []db.MatchRow{{
			MatchKey:    "match:2026-05-10T21:29:28",
			SourceFiles: []string{"rank.png"},
			Rank:        "platinum",
			SRJSON:      `[{"hero":"juno","start":2845,"end":2867,"change":22}]`,
			// Note: Result column NOT set — that's what triggers inference.
		}},
	}
	a := NewWithStore(fs)

	got, err := a.GetMatchResults()
	if err != nil {
		t.Fatalf("GetMatchResults: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("len(got) = %d, want 1", len(got))
	}
	if got[0].Data.Result != "victory" {
		t.Errorf("inferResultFromRank did not fire: Result = %q, want \"victory\"", got[0].Data.Result)
	}
}

func TestInference_NeverPersistedToStore(t *testing.T) {
	// Same setup as the read-time test above — but after calling
	// GetMatchResults (which mutates a *copy* of each row), the
	// underlying store row MUST still have Result="" and PercentPlayed=0.
	// If a future refactor moved inference into mergeMatchResult or
	// upsertMergedRow, this assertion would catch the regression.
	fs := &fakeStore{
		rows: []db.MatchRow{{
			MatchKey:         "match:2026-05-10T21:29:28",
			SourceFiles:      []string{"rank.png"},
			Rank:             "platinum",
			SRJSON:           `[{"hero":"juno","start":2845,"end":2867,"change":22}]`,
			HeroesPlayedJSON: `[{"hero":"juno","percent_played":0}]`,
		}},
	}
	a := NewWithStore(fs)

	// Pull through the read-time inference path.
	if _, err := a.GetMatchResults(); err != nil {
		t.Fatalf("GetMatchResults: %v", err)
	}

	// Now query the store directly — the raw row should be untouched.
	raw, err := fs.LoadAll()
	if err != nil {
		t.Fatalf("fakeStore.LoadAll: %v", err)
	}
	if got := raw[0].Result; got != "" {
		t.Errorf("inference leaked into store: raw.Result = %q, want \"\" (raw); inference must run at read time only", got)
	}
	// The HeroesPlayedJSON column is the source of truth for hero stats.
	// inferSoleHeroPercent should not have rewritten the percent_played:0
	// embedded in the JSON.
	wantJSON := `[{"hero":"juno","percent_played":0}]`
	if got := raw[0].HeroesPlayedJSON; got != wantJSON {
		t.Errorf("inferSoleHeroPercent leaked into HeroesPlayedJSON\n got: %s\nwant: %s", got, wantJSON)
	}
}

func TestInference_DoesNotOverrideStoredResult(t *testing.T) {
	// SR.Change > 0 would normally trigger inferResultFromRank → "victory",
	// but the stored row already has Result="defeat" from a SUMMARY
	// screenshot. Inference must NOT overwrite an authoritative value.
	fs := &fakeStore{
		rows: []db.MatchRow{{
			MatchKey:    "match:2026-05-10T21:29:28",
			SourceFiles: []string{"summary.png", "rank.png"},
			Rank:        "platinum",
			Result:      "defeat",
			SRJSON:      `[{"hero":"juno","start":2845,"end":2867,"change":22}]`,
		}},
	}
	a := NewWithStore(fs)

	got, err := a.GetMatchResults()
	if err != nil {
		t.Fatalf("GetMatchResults: %v", err)
	}
	if got[0].Data.Result != "defeat" {
		t.Errorf("inference overrode authoritative SUMMARY result: got %q, want \"defeat\"", got[0].Data.Result)
	}
}

func TestInference_SoleHeroPercent_DoesNotOverrideStored(t *testing.T) {
	// A single-hero row already has PercentPlayed=80 (e.g. from a SUMMARY
	// screenshot where the player swapped briefly to another hero whose
	// row was lost). inferSoleHeroPercent's "one hero → 100%" rule must
	// NOT clobber that stored value.
	fs := &fakeStore{
		rows: []db.MatchRow{{
			MatchKey:         "match:2026-05-10T21:29:28",
			SourceFiles:      []string{"summary.png"},
			Hero:             "lucio",
			HeroesPlayedJSON: `[{"hero":"lucio","percent_played":80}]`,
		}},
	}
	a := NewWithStore(fs)

	got, err := a.GetMatchResults()
	if err != nil {
		t.Fatalf("GetMatchResults: %v", err)
	}
	if got[0].Data.HeroesPlayed[0].PercentPlayed != 80 {
		t.Errorf("inferSoleHeroPercent overrode stored value: got %d, want 80",
			got[0].Data.HeroesPlayed[0].PercentPlayed)
	}
}

// Sanity: the inference helpers themselves should be pure — calling
// them twice in a row must produce the same result as calling them once.
// Catches a refactor that introduces hidden state or non-idempotent logic.
func TestInference_Idempotent(t *testing.T) {
	d := &parser.MatchResult{
		Rank: "platinum",
		SR:   []parser.HeroSR{{Hero: "juno", Change: 22}},
	}
	inferResultFromRank(d)
	first := d.Result
	inferResultFromRank(d)
	if d.Result != first {
		t.Errorf("inferResultFromRank not idempotent: first=%q second=%q", first, d.Result)
	}

	hp := &parser.MatchResult{
		HeroesPlayed: []parser.HeroPlay{{Hero: "lucio"}},
	}
	inferSoleHeroPercent(hp)
	firstPct := hp.HeroesPlayed[0].PercentPlayed
	inferSoleHeroPercent(hp)
	if hp.HeroesPlayed[0].PercentPlayed != firstPct {
		t.Errorf("inferSoleHeroPercent not idempotent: first=%d second=%d",
			firstPct, hp.HeroesPlayed[0].PercentPlayed)
	}
}
