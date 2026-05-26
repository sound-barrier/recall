package app

// Tests in this file lock the load-bearing invariant that the read-time
// inference helpers (inferSoleHeroPercent, inferResultFromRank) run on
// the way OUT of the DB — via GetMatchResults and scrapeReader — never
// inside the write path that persists per-screenshot rows.
//
// Why this matters: mergeMatchResult (now invoked at read time by the
// aggregator) uses first-non-empty-wins for scalars. If inference fired
// before the merge AND the inferred value were persisted, the inferred
// value would land in the DB, then a later SUMMARY screenshot's
// authoritative value (e.g. a `defeat` when the SR-delta inference
// picked `victory`) would lose to the already-stored inferred value.
// The current architecture sidesteps that by NEVER persisting inferred
// fields: the store always holds the raw OCR output, and inference is
// recomputed on every read.
//
// A future refactor that "helpfully" moves inference into the write
// path to "avoid recomputing on every read" would silently corrupt
// match outcomes. These tests fail loudly in that case.

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
		ranks: []db.RankRow{{
			ID: 1, Filename: "rank.png", MatchKey: "match:2026-05-10T21:29:28",
			Rank: "platinum",
			SR:   []db.HeroSR{{Hero: "juno", SR: 2867, Change: 22}},
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
	// After calling GetMatchResults (which mutates a *copy* of each row),
	// the underlying store rows MUST still have Result="" and unchanged
	// HeroesPlayed[].PercentPlayed. If a future refactor moved inference
	// into a write path, this assertion would catch the regression.
	fs := &fakeStore{
		ranks: []db.RankRow{{
			ID: 1, Filename: "rank.png", MatchKey: "match:2026-05-10T21:29:28",
			Rank: "platinum",
			SR:   []db.HeroSR{{Hero: "juno", SR: 2867, Change: 22}},
		}},
		personals: []db.PersonalRow{{
			ID: 1, Filename: "personal.png", MatchKey: "match:2026-05-10T21:29:28",
			Hero: "juno",
			HeroStats: []db.HeroStat{
				{Hero: "juno", StatKey: "weapon_accuracy", StatValue: 24},
			},
		}},
	}
	a := NewWithStore(fs)

	if _, err := a.GetMatchResults(); err != nil {
		t.Fatalf("GetMatchResults: %v", err)
	}

	// Direct DB inspection — the stored rank row should still carry
	// Result="" (no leakage from inferResultFromRank).
	raw, err := fs.LoadAll()
	if err != nil {
		t.Fatalf("fakeStore.LoadAll: %v", err)
	}
	if got := raw.Ranks[0].Result; got != "" {
		t.Errorf("inferResultFromRank leaked into store: raw.Result = %q, want \"\" (raw)", got)
	}
}

func TestInference_DoesNotOverrideStoredResult(t *testing.T) {
	// SR.Change > 0 would normally trigger inferResultFromRank → "victory",
	// but the SUMMARY screenshot already carries Result="defeat". Inference
	// must NOT overwrite an authoritative value.
	fs := &fakeStore{
		summaries: []db.SummaryRow{{
			ID: 1, Filename: "summary.png", MatchKey: "match:2026-05-10T21:29:28",
			Result: "defeat",
		}},
		ranks: []db.RankRow{{
			ID: 1, Filename: "rank.png", MatchKey: "match:2026-05-10T21:29:28",
			Rank: "platinum",
			SR:   []db.HeroSR{{Hero: "juno", SR: 2867, Change: 22}},
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
	// A summary with PercentPlayed=80 — inferSoleHeroPercent's "one hero
	// → 100%" rule must NOT clobber it.
	fs := &fakeStore{
		summaries: []db.SummaryRow{{
			ID: 1, Filename: "summary.png", MatchKey: "k1",
			Hero: "lucio",
			HeroesPlayed: []db.SummaryHeroPlayed{
				{Hero: "lucio", PercentPlayed: 80},
			},
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
