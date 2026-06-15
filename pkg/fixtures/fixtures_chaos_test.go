package fixtures_test

import (
	"reflect"
	"strings"
	"testing"

	"recall/pkg/db"
	"recall/pkg/db/dbtest"
	"recall/pkg/fixtures"
)

func TestChaos_ZeroRatioMatchesNoChaos(t *testing.T) {
	a := fixtures.GenerateMatchFixture(50, 11, "")
	b := fixtures.GenerateMatchFixtureWithChaos(50, 11, "", 0)
	if !reflect.DeepEqual(a, b) {
		t.Fatal("chaosRatio=0 should be byte-identical to GenerateMatchFixture")
	}
}

func TestChaos_FullRatioMutatesMostRows(t *testing.T) {
	// At chaosRatio=1, every match gets 1-2 shapes picked uniformly
	// from 6 categories. Aggregation-conflict is the only one that
	// leaves the original summary untouched (it only appends new
	// rows). The expected unmutated rate is ~10% (P(every pick is
	// aggregation-conflict)), so we assert >80% mutated to leave
	// room for small-n variance while still catching "chaos didn't
	// fire" regressions.
	const n = 200
	fx := fixtures.GenerateMatchFixtureWithChaos(n, 7, "", 1.0)

	// Pre-index the seed slices so the per-row check is O(1) — the
	// missing-play-mode + missing-queue-type categories don't leave a
	// signature on the SummaryRow itself; they show up as the
	// match_key being ABSENT from fx.PlayModes / fx.Queues.
	seenPlayMode := make(map[string]bool, len(fx.PlayModes))
	for _, p := range fx.PlayModes {
		seenPlayMode[p.MatchKey] = true
	}
	seenQueue := make(map[string]bool, len(fx.Queues))
	for _, q := range fx.Queues {
		seenQueue[q.MatchKey] = true
	}

	mutated := 0
	for i := range n {
		s := fx.Summaries[i]
		if hasChaosSignature(s) || !seenPlayMode[s.MatchKey] || !seenQueue[s.MatchKey] {
			mutated++
		}
	}
	if mutated < n*8/10 {
		t.Fatalf("expected at least 80%% of originals chaos-mutated at ratio=1.0; got %d/%d", mutated, n)
	}
}

func TestChaos_AggregationConflictAddsRows(t *testing.T) {
	// Aggregation-conflict appends extra summaries past the original
	// N. Over n=200 at ratio=1.0, at least a handful of matches
	// should have picked the conflict category, so total Summaries
	// will exceed n.
	fx := fixtures.GenerateMatchFixtureWithChaos(200, 7, "", 1.0)
	if len(fx.Summaries) <= 200 {
		t.Fatalf("expected aggregation-conflict to add rows past n=200; got %d", len(fx.Summaries))
	}

	// Every appended extra must share its match_key with an original
	// summary (that's the whole point — same key, different content).
	originalKeys := make(map[string]bool, 200)
	for i := range 200 {
		originalKeys[fx.Summaries[i].MatchKey] = true
	}
	for i := 200; i < len(fx.Summaries); i++ {
		if !originalKeys[fx.Summaries[i].MatchKey] {
			t.Fatalf("extra summary %d carries unknown match_key %s", i, fx.Summaries[i].MatchKey)
		}
	}
}

func TestChaos_MissingPlayModeProducesEmptyModeAndDroppedSeed(t *testing.T) {
	// At ratio=1.0 with 8 categories and 1-2 picks per match,
	// chaosMissingPlayMode is expected on roughly 3/8 of n. We
	// assert SOMETHING shows up rather than an exact count so the
	// test isn't fragile to small RNG nudges.
	const n = 300
	fx := fixtures.GenerateMatchFixtureWithChaos(n, 17, "", 1.0)

	playModeKeys := make(map[string]bool, len(fx.PlayModes))
	for _, p := range fx.PlayModes {
		playModeKeys[p.MatchKey] = true
	}

	emptyModeWithoutSeed := 0
	for i := range n {
		s := fx.Summaries[i]
		if s.Playlist == "" && !playModeKeys[s.MatchKey] {
			emptyModeWithoutSeed++
		}
	}
	if emptyModeWithoutSeed < 10 {
		t.Fatalf("chaosMissingPlayMode should clear data.mode AND drop the PlayModeSeed for >=10 matches at n=%d ratio=1.0; got %d",
			n, emptyModeWithoutSeed)
	}
}

func TestChaos_MissingQueueTypeDropsSeed(t *testing.T) {
	const n = 300
	fx := fixtures.GenerateMatchFixtureWithChaos(n, 23, "", 1.0)

	queueKeys := make(map[string]bool, len(fx.Queues))
	for _, q := range fx.Queues {
		queueKeys[q.MatchKey] = true
	}

	withoutQueueSeed := 0
	for i := range n {
		if !queueKeys[fx.Summaries[i].MatchKey] {
			withoutQueueSeed++
		}
	}
	if withoutQueueSeed < 10 {
		t.Fatalf("chaosMissingQueueType should drop the QueueSeed for >=10 matches at n=%d ratio=1.0; got %d",
			n, withoutQueueSeed)
	}
}

func TestChaos_IsDeterministic(t *testing.T) {
	a := fixtures.GenerateMatchFixtureWithChaos(50, 3, "", 0.5)
	b := fixtures.GenerateMatchFixtureWithChaos(50, 3, "", 0.5)
	if !reflect.DeepEqual(a, b) {
		t.Fatal("same (n, seed, ratio) should produce byte-identical chaos output")
	}
}

func TestChaos_RoundTripsThroughStore(t *testing.T) {
	// Sanity: chaos shapes still upsert cleanly into the Fake (which
	// validates the Store-interface contracts). If a future chaos
	// category adds an invariant violation, this catches it before
	// the seed-dev CLI does.
	fx := fixtures.GenerateMatchFixtureWithChaos(50, 13, "", 0.5)
	fs := dbtest.New()
	for _, r := range fx.Summaries {
		if err := fs.UpsertSummary(r); err != nil {
			t.Fatalf("UpsertSummary(%s): %v", r.MatchKey, err)
		}
	}
	for _, r := range fx.Teams {
		if err := fs.UpsertTeams(r); err != nil {
			t.Fatalf("UpsertTeams(%s): %v", r.MatchKey, err)
		}
	}
}

// hasChaosSignature returns true when s carries one of the chaos
// categories' visible side-effects. Used by the ratio test to confirm
// chaos actually fires.
func hasChaosSignature(s db.SummaryRow) bool {
	switch {
	case len(s.Hero) > 100, len(s.Map) > 100:
		return true // long-strings
	case containsAny(s.Hero, fixtures.ChaosEmojis), containsAny(s.Map, fixtures.ChaosEmojis):
		return true // unicode
	case s.PerfElimTotal > 100_000 || s.PerfAssistsTotal < 0:
		return true // numeric-extreme
	case len(s.HeroesPlayed) > 10:
		return true // cardinality
	case s.Date == "1970-01-01" || s.Date == "2099-12-31" || s.Date == "yesterday":
		return true // date-extreme
	}
	return false
}

func containsAny(s string, needles []string) bool {
	for _, n := range needles {
		if strings.Contains(s, n) {
			return true
		}
	}
	return false
}
