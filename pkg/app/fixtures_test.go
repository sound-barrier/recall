package app

import (
	"reflect"
	"testing"
	"time"

	"recall/pkg/db/dbtest"
)

func TestGenerateMatchFixture_RoundTripsThroughStore(t *testing.T) {
	fx := GenerateMatchFixture(50, 42, "")

	// Per-match screenshot-type dice rolls (~95% summary, ~80% teams)
	// produce variable counts. The hard floor is "at least one
	// screenshot per planned match", but individual type-counts swing
	// match-to-match. Assert each type's count stays in a plausible
	// band so a regression that always-emits or never-emits a type
	// gets caught.
	if got := len(fx.Summaries); got < 40 || got > 50 {
		t.Errorf("Summaries: got %d, want 40-50 (~95%% of 50)", got)
	}
	if got := len(fx.Scoreboards); got < 30 || got > 55 {
		// Upper bound includes ~1% ambiguous extras (50/100 = 0 at
		// this size, but kept for documentation).
		t.Errorf("Scoreboards: got %d, want 30-55 (~80%% of 50)", got)
	}

	seen := make(map[string]struct{}, len(fx.Summaries))
	for _, s := range fx.Summaries {
		seen[s.MatchKey] = struct{}{}
	}
	if len(seen) != len(fx.Summaries) {
		t.Fatalf("expected unique summary match keys, got %d unique / %d total", len(seen), len(fx.Summaries))
	}

	fs := dbtest.New()
	for _, r := range fx.Summaries {
		if err := fs.UpsertSummary(r); err != nil {
			t.Fatalf("UpsertSummary(%s): %v", r.MatchKey, err)
		}
	}
	for _, r := range fx.Scoreboards {
		if err := fs.UpsertScoreboard(r); err != nil {
			t.Fatalf("UpsertScoreboard(%s): %v", r.MatchKey, err)
		}
	}
	for _, r := range fx.Personals {
		if err := fs.UpsertPersonal(r); err != nil {
			t.Fatalf("UpsertPersonal(%s): %v", r.MatchKey, err)
		}
	}
	for _, r := range fx.Ranks {
		if err := fs.UpsertRank(r); err != nil {
			t.Fatalf("UpsertRank(%s): %v", r.MatchKey, err)
		}
	}
	for _, r := range fx.Unknowns {
		if err := fs.UpsertUnknown(r); err != nil {
			t.Fatalf("UpsertUnknown(%s): %v", r.Filename, err)
		}
	}
	for _, a := range fx.Ambiguous {
		if err := fs.ApplyAmbiguity(a.Filename, a.Candidates); err != nil {
			t.Fatalf("ApplyAmbiguity(%s): %v", a.Filename, err)
		}
	}
}

func TestGenerateMatchFixture_IsDeterministic(t *testing.T) {
	a := GenerateMatchFixture(10, 7, "")
	b := GenerateMatchFixture(10, 7, "")

	if !reflect.DeepEqual(a.Summaries[0], b.Summaries[0]) {
		t.Fatalf("Summaries[0] differ between identical seeds:\n a=%+v\n b=%+v", a.Summaries[0], b.Summaries[0])
	}
	if !reflect.DeepEqual(a.Scoreboards[0], b.Scoreboards[0]) {
		t.Fatal("Scoreboards[0] differ between identical seeds")
	}
}

func TestGenerateMatchFixture_DatesWithinRange(t *testing.T) {
	fx := GenerateMatchFixture(200, 1, "")

	start, _ := time.Parse("2006-01-02", fixtureDateStart)
	// Allow a small overflow window past the upper bound — the dedupe
	// pass bumps colliding timestamps by +1 minute, which can spill a
	// match past midnight on the last day. A 3-day buffer is more than
	// enough at our scale.
	end, _ := time.Parse("2006-01-02", fixtureDateEnd)
	end = end.AddDate(0, 0, 3)

	for _, s := range fx.Summaries {
		d, err := time.Parse("2006-01-02", s.Date)
		if err != nil {
			t.Fatalf("bad date %q on match_key %s: %v", s.Date, s.MatchKey, err)
		}
		if d.Before(start) || d.After(end) {
			t.Fatalf("date %s on match_key %s outside [%s, %s]", s.Date, s.MatchKey, fixtureDateStart, fixtureDateEnd)
		}
	}
}

func TestGenerateMatchFixture_DifferentSeedsDiffer(t *testing.T) {
	// Sanity check: two different seeds should produce visibly
	// different first matches (proves the seed actually influences
	// every choice, not just one path).
	a := GenerateMatchFixture(10, 1, "")
	b := GenerateMatchFixture(10, 2, "")
	if reflect.DeepEqual(a.Summaries[0], b.Summaries[0]) {
		t.Fatal("Summaries[0] identical across different seeds — seed isn't doing anything")
	}
}

func TestGenerateMatchFixture_ResultDistribution(t *testing.T) {
	// Realistic player history: ~49.5% W, ~49.5% L, ~1% D. Uniform
	// would produce 33/33/33 — wrong at any N. At N=10000 the law of
	// large numbers tightens the spread enough that we can assert on
	// the bands directly without re-running multiple seeds.
	const n = 10000
	fx := GenerateMatchFixture(n, 1, "")

	counts := map[string]int{}
	for _, s := range fx.Summaries {
		counts[s.Result]++
	}

	w := counts["victory"]
	l := counts["defeat"]
	d := counts["draw"]

	// Each of W and L should land in [47%, 51%]. Draws in [0.5%, 1.5%].
	if w < n*47/100 || w > n*51/100 {
		t.Errorf("victory rate %.2f%% outside [47%%, 51%%]", float64(w)/float64(n)*100)
	}
	if l < n*47/100 || l > n*51/100 {
		t.Errorf("defeat rate %.2f%% outside [47%%, 51%%]", float64(l)/float64(n)*100)
	}
	if d < n*5/1000 || d > n*15/1000 {
		t.Errorf("draw rate %.2f%% outside [0.5%%, 1.5%%]", float64(d)/float64(n)*100)
	}
}

func TestGenerateMatchFixture_FlexCoversEveryMapAndHero(t *testing.T) {
	// Default style (flex) must surface every map in fixtureMaps AND
	// every hero across the three role pools at least once — that's
	// what the coverage pass exists for. Without it, top-heavy map
	// weights + 6-9 flex mains miss a handful of tail values per
	// run, blinding eyeball UI testing to icons / labels for the
	// missing entries.
	const n = 100
	fx := GenerateMatchFixture(n, 1, "")

	seenMaps := map[string]bool{}
	seenHeroes := map[string]bool{}
	for _, s := range fx.Summaries {
		seenMaps[s.Map] = true
		// Scan every hero in HeroesPlayed — primary AND cameos.
		// The coverage pass patches missing heroes as 5% cameos so
		// the primary distribution stays believable.
		for _, hp := range s.HeroesPlayed {
			seenHeroes[hp.Hero] = true
		}
	}
	for _, m := range fixtureMaps {
		if !seenMaps[m] {
			t.Errorf("map %q missing from default-flex corpus", m)
		}
	}
	allHeroes := make([]string, 0, len(fixtureTanks)+len(fixtureSupports)+len(fixtureDPS))
	allHeroes = append(allHeroes, fixtureTanks...)
	allHeroes = append(allHeroes, fixtureSupports...)
	allHeroes = append(allHeroes, fixtureDPS...)
	for _, h := range allHeroes {
		if !seenHeroes[h] {
			t.Errorf("hero %q missing from default-flex corpus", h)
		}
	}
}

func TestGenerateMatchFixture_FlexSwapsMostMatches(t *testing.T) {
	// Real players swap heroes mid-match most games — only ~10% stick
	// with one hero start-to-finish. At N=500 the binomial spread is
	// tight enough to assert single-hero matches fall in [5%, 20%].
	const n = 500
	fx := GenerateMatchFixture(n, 1, "flex")

	single := 0
	for _, s := range fx.Summaries {
		if len(s.HeroesPlayed) == 1 {
			single++
		}
	}
	if single*100 < n*5 || single*100 > n*20 {
		t.Errorf("single-hero matches %d/%d (%.1f%%) outside [5%%, 20%%]",
			single, n, float64(single)*100/float64(n))
	}
}

func TestGenerateMatchFixture_OneTrickNeverSwaps(t *testing.T) {
	// One-tricks by definition never swap mid-match. Every summary's
	// HeroesPlayed must have exactly one entry.
	const n = 200
	fx := GenerateMatchFixture(n, 1, "one-trick")

	for i, s := range fx.Summaries {
		if len(s.HeroesPlayed) != 1 {
			t.Fatalf("one-trick summary %d has %d heroes_played entries; expected 1",
				i, len(s.HeroesPlayed))
		}
	}
}

func TestGenerateMatchFixture_HeroPercentsSumTo100(t *testing.T) {
	// Every match's percent_played must sum to 100 — coverage cameos
	// dock the primary by exactly the cameo amount so the invariant
	// holds even on patched matches. A few percent off is fine
	// (cameo floor + cap interactions); blow up if we land outside
	// [95, 105].
	fx := GenerateMatchFixture(200, 1, "")

	for _, s := range fx.Summaries {
		sum := 0
		for _, hp := range s.HeroesPlayed {
			sum += hp.PercentPlayed
		}
		if sum < 95 || sum > 105 {
			t.Errorf("match %s: percent_played sums to %d, expected ~100", s.MatchKey, sum)
		}
	}
}

func TestGenerateMatchFixture_OneTrickStaysOneTrick(t *testing.T) {
	// Sanity: the coverage pass is flex-only. one-trick corpuses
	// should stay concentrated on the player's favorite hero
	// (95% main, 5% experiments). Catches a regression where the
	// coverage pass would accidentally fire for non-flex styles.
	const n = 200
	fx := GenerateMatchFixture(n, 1, "one-trick")

	heroes := map[string]int{}
	for _, s := range fx.Summaries {
		heroes[s.Hero]++
	}
	var maxCount int
	for _, c := range heroes {
		if c > maxCount {
			maxCount = c
		}
	}
	// Scale against len(fx.Summaries) — the dice rolls drop ~5% of
	// matches' summaries, so n isn't the right denominator.
	total := len(fx.Summaries)
	if maxCount*100 < total*85 {
		t.Errorf("expected ≥85%% of summaries on the one-trick's main hero; got max %d/%d", maxCount, total)
	}
}

func TestGenerateMatchFixture_MapsAreTopHeavy(t *testing.T) {
	// The map distribution should be visibly top-heavy: the most
	// played map should carry significantly more matches than the
	// median. At N=500 with weight-decay 0.75, the top map's share
	// is ~22% of an even split's ~8% — easily 2x the median.
	const n = 500
	fx := GenerateMatchFixture(n, 1, "")

	counts := map[string]int{}
	for _, s := range fx.Summaries {
		counts[s.Map]++
	}
	values := make([]int, 0, len(counts))
	for _, c := range counts {
		values = append(values, c)
	}
	if len(values) < 2 {
		t.Fatalf("expected multiple maps in corpus; got %d", len(values))
	}
	// Find max + median.
	var maxV int
	for _, v := range values {
		if v > maxV {
			maxV = v
		}
	}
	if maxV*100 < n*15 {
		t.Errorf("top map carries %d/%d (%.1f%%) — expected at least 15%% (top-heavy distribution)",
			maxV, n, float64(maxV)*100/float64(n))
	}
}

func TestGenerateMatchFixture_RoleQueueLocksToOneRolePerMatch(t *testing.T) {
	// Role queue (5v5) locks the player to ONE role for the entire
	// match — you can't pick lucio (support) and reaper (DPS) in the
	// same role-queue game. Open queue (6v6) does allow mixing. This
	// test pins the rule across every style + play_mode combination
	// the seeder produces in one run.
	const n = 500
	fx := GenerateMatchFixture(n, 1, "")

	queueByKey := make(map[string]string, len(fx.Queues))
	for _, q := range fx.Queues {
		queueByKey[q.MatchKey] = q.QueueType
	}

	roleQueueChecked := 0
	for _, s := range fx.Summaries {
		if queueByKey[s.MatchKey] != "role" {
			continue
		}
		roleQueueChecked++
		primaryRole := roleOfHero(s.Hero)
		for _, hp := range s.HeroesPlayed {
			got := roleOfHero(hp.Hero)
			if got != primaryRole {
				t.Errorf("role-queue match %s (primary=%s/%s): hero %s/%s violates single-role constraint",
					s.MatchKey, s.Hero, primaryRole, hp.Hero, got)
			}
		}
	}
	if roleQueueChecked == 0 {
		t.Fatal("sampled corpus had no role-queue matches to verify against — distribution drifted?")
	}
}

func TestGenerateMatchFixture_OpenQueueCanMixRoles(t *testing.T) {
	// Sanity check the other side of the bug fix: open-queue matches
	// MUST still be allowed to mix roles within a single match
	// (that's the whole point of 6v6 open queue). With a flex player
	// and ~20% open queue at N=500, at least one open-queue match
	// should naturally produce a mixed-role HeroesPlayed list.
	const n = 500
	fx := GenerateMatchFixture(n, 1, "")

	queueByKey := make(map[string]string, len(fx.Queues))
	for _, q := range fx.Queues {
		queueByKey[q.MatchKey] = q.QueueType
	}

	sawMixedRolesInOpenQueue := false
	for _, s := range fx.Summaries {
		if queueByKey[s.MatchKey] != "open" {
			continue
		}
		if len(s.HeroesPlayed) < 2 {
			continue
		}
		first := roleOfHero(s.HeroesPlayed[0].Hero)
		for _, hp := range s.HeroesPlayed[1:] {
			if roleOfHero(hp.Hero) != first {
				sawMixedRolesInOpenQueue = true
				break
			}
		}
		if sawMixedRolesInOpenQueue {
			break
		}
	}
	if !sawMixedRolesInOpenQueue {
		t.Error("expected at least one open-queue match to mix roles; flex+open should produce them naturally")
	}
}

func TestGenerateMatchFixture_PlayModeDistribution(t *testing.T) {
	// Every match gets a play-mode tag, biased ~90% competitive /
	// ~10% quickplay. At N=10000 the binomial 95% CI for competitive
	// is roughly [89.4%, 90.6%]; allow [85%, 95%] to absorb
	// seed-specific variance.
	const n = 10000
	fx := GenerateMatchFixture(n, 1, "")

	// PlayModes are tagged per-summary; with ~95% summary dice rolls
	// the tagged count tracks the summary count, not n. Allow a wide
	// band so per-seed variance doesn't flake.
	if len(fx.PlayModes) < n*90/100 || len(fx.PlayModes) > n {
		t.Fatalf("expected ~95%% of matches to be play-mode-tagged (got %d/%d)", len(fx.PlayModes), n)
	}

	comp, qp := 0, 0
	for _, p := range fx.PlayModes {
		switch p.PlayMode {
		case "competitive":
			comp++
		case "quickplay":
			qp++
		default:
			t.Fatalf("play-mode carries invalid value %q (must be quickplay or competitive)", p.PlayMode)
		}
	}
	// Rates computed against tagged count (not n) since not every
	// match gets a summary under the ~95% dice roll.
	total := len(fx.PlayModes)
	if comp*100 < total*85 || comp*100 > total*95 {
		t.Errorf("competitive rate %.2f%% outside [85%%, 95%%]", float64(comp)*100/float64(total))
	}
	if qp*100 < total*5 || qp*100 > total*15 {
		t.Errorf("quickplay rate %.2f%% outside [5%%, 15%%]", float64(qp)*100/float64(total))
	}

	// Every play-mode entry must reference a real match_key.
	keys := make(map[string]bool, len(fx.Summaries))
	for _, s := range fx.Summaries {
		keys[s.MatchKey] = true
	}
	for _, p := range fx.PlayModes {
		if !keys[p.MatchKey] {
			t.Fatalf("play-mode references unknown match_key %s", p.MatchKey)
		}
	}
}

func TestGenerateMatchFixture_QuickplayWidensHeroPool(t *testing.T) {
	// Aggressive QP widening: in quickplay the player picks heroes
	// they wouldn't touch in competitive. Compare the number of
	// DISTINCT heroes that appear in QP matches vs comp matches per
	// match — QP should be visibly higher. (Absolute counts compare
	// poorly because comp has ~9x more matches.)
	const n = 5000
	fx := GenerateMatchFixture(n, 1, "")

	playModeByKey := make(map[string]string, len(fx.PlayModes))
	for _, p := range fx.PlayModes {
		playModeByKey[p.MatchKey] = p.PlayMode
	}

	compHeroes := map[string]bool{}
	qpHeroes := map[string]bool{}
	compMatches, qpMatches := 0, 0
	for _, s := range fx.Summaries {
		pm := playModeByKey[s.MatchKey]
		switch pm {
		case "competitive":
			compMatches++
			for _, hp := range s.HeroesPlayed {
				compHeroes[hp.Hero] = true
			}
		case "quickplay":
			qpMatches++
			for _, hp := range s.HeroesPlayed {
				qpHeroes[hp.Hero] = true
			}
		}
	}
	if qpMatches == 0 || compMatches == 0 {
		t.Fatalf("need both QP and comp matches in the sample; got QP=%d comp=%d", qpMatches, compMatches)
	}

	qpDensity := float64(len(qpHeroes)) / float64(qpMatches)
	compDensity := float64(len(compHeroes)) / float64(compMatches)
	// QP should show measurably more distinct heroes per match —
	// per the aggressive widening spec, QP density is meaningfully
	// higher than comp density.
	if qpDensity <= compDensity {
		t.Errorf("expected QP hero-density (%.3f) > comp hero-density (%.3f); QP widening not firing",
			qpDensity, compDensity)
	}
}

func TestGenerateMatchFixture_QueueDistribution(t *testing.T) {
	// Every match gets a queue tag, biased 80% role / 20% open.
	// At N=10000 the binomial 95% CI for role is roughly [78.7%,
	// 81.3%]; allow [75%, 85%] to absorb seed-specific variance.
	const n = 10000
	fx := GenerateMatchFixture(n, 1, "")

	// Queues are tagged per-summary; with ~95% summary dice rolls
	// the tagged count tracks the summary count, not n.
	if len(fx.Queues) < n*90/100 || len(fx.Queues) > n {
		t.Fatalf("expected ~95%% of matches to be queue-tagged (got %d/%d)", len(fx.Queues), n)
	}

	role, open := 0, 0
	for _, q := range fx.Queues {
		switch q.QueueType {
		case "role":
			role++
		case "open":
			open++
		default:
			t.Fatalf("queue carries invalid QueueType %q (must be role or open)", q.QueueType)
		}
	}
	total := len(fx.Queues)
	if role*100 < total*75 || role*100 > total*85 {
		t.Errorf("role-queue rate %.2f%% outside [75%%, 85%%]", float64(role)*100/float64(total))
	}
	if open*100 < total*15 || open*100 > total*25 {
		t.Errorf("open-queue rate %.2f%% outside [15%%, 25%%]", float64(open)*100/float64(total))
	}

	// Every queue must reference a real match_key.
	keys := make(map[string]bool, len(fx.Summaries))
	for _, s := range fx.Summaries {
		keys[s.MatchKey] = true
	}
	for _, q := range fx.Queues {
		if !keys[q.MatchKey] {
			t.Fatalf("queue references unknown match_key %s", q.MatchKey)
		}
	}
}

func TestGenerateMatchFixture_ScreenshotTypeDistribution(t *testing.T) {
	// Per-match screenshot-type dice models real capture habits:
	// ~95% summary, ~80% teams (scoreboard), ~70% personal, ~15% rank.
	// Independent rolls so each match's combination of types varies.
	// At N=5000 the binomial bands are tight enough to assert on each
	// rate directly.
	const n = 5000
	fx := GenerateMatchFixture(n, 1, "")

	// Bands include a 5pp tolerance + the ~1% ambiguous scoreboards.
	if r := float64(len(fx.Summaries)) * 100 / float64(n); r < 92 || r > 98 {
		t.Errorf("summary rate %.2f%% outside [92%%, 98%%]", r)
	}
	if r := float64(len(fx.Scoreboards)) * 100 / float64(n); r < 76 || r > 85 {
		t.Errorf("scoreboard rate %.2f%% outside [76%%, 85%%]", r)
	}
	if r := float64(len(fx.Personals)) * 100 / float64(n); r < 66 || r > 74 {
		t.Errorf("personal rate %.2f%% outside [66%%, 74%%]", r)
	}
	if r := float64(len(fx.Ranks)) * 100 / float64(n); r < 12 || r > 18 {
		t.Errorf("rank rate %.2f%% outside [12%%, 18%%]", r)
	}
}

func TestGenerateMatchFixture_UnknownAndAmbiguousCounts(t *testing.T) {
	// Unknown screenshots model ~2% of N; ambiguous ~1%. Both are
	// fixed-share emissions from derived RNGs (seed+5 / seed+6) — no
	// dice variance — so at any N ≥ 100 the counts are exact.
	const n = 500
	fx := GenerateMatchFixture(n, 1, "")

	if got, want := len(fx.Unknowns), n*2/100; got != want {
		t.Errorf("unknown count: got %d, want %d (~2%% of %d)", got, want, n)
	}
	if got, want := len(fx.Ambiguous), n/100; got != want {
		t.Errorf("ambiguous count: got %d, want %d (~1%% of %d)", got, want, n)
	}

	// Every unknown row carries an unmatched- match key referencing
	// its own filename — the parser's convention for files without a
	// resolvable timestamp.
	for _, u := range fx.Unknowns {
		mk, err := ParseMatchKey(u.MatchKey)
		if err != nil || !mk.IsUnmatched() {
			t.Errorf("unknown %s has non-unmatched key %q", u.Filename, u.MatchKey)
		}
	}

	// Every ambiguous seed pairs with a scoreboard row carrying an
	// ambiguous- match key for its filename, and points at 2-3 real
	// tracked match_keys from the main corpus.
	trackedSet := make(map[string]bool, len(fx.Summaries))
	for _, s := range fx.Summaries {
		if mk, err := ParseMatchKey(s.MatchKey); err == nil && mk.IsTracked() {
			trackedSet[s.MatchKey] = true
		}
	}
	scoreboardByFilename := make(map[string]string, len(fx.Scoreboards))
	for _, sb := range fx.Scoreboards {
		scoreboardByFilename[sb.Filename] = sb.MatchKey
	}
	for _, a := range fx.Ambiguous {
		if c := len(a.Candidates); c < 2 || c > 3 {
			t.Errorf("ambiguous %s has %d candidates, want 2 or 3", a.Filename, c)
		}
		gotKey, ok := scoreboardByFilename[a.Filename]
		if !ok {
			t.Errorf("ambiguous %s has no companion scoreboard row", a.Filename)
			continue
		}
		mk, err := ParseMatchKey(gotKey)
		if err != nil || !mk.IsAmbiguous() {
			t.Errorf("ambiguous %s companion scoreboard key %q isn't ambiguous-shaped", a.Filename, gotKey)
		}
		for _, c := range a.Candidates {
			if !trackedSet[c.MatchKey] {
				t.Errorf("ambiguous %s candidate %s isn't a real tracked match_key from the corpus", a.Filename, c.MatchKey)
			}
		}
	}
}

func TestGenerateMatchFixture_ReviewRate(t *testing.T) {
	// ~1.5% of matches should carry a review. At N=10000, 4-sigma
	// bounds are roughly [120, 180]; we use [50, 300] as a loose
	// "rate is in the right ballpark" check that catches "0% reviewed"
	// and "everything reviewed" regressions without flaking.
	const n = 10000
	fx := GenerateMatchFixture(n, 1, "")

	if len(fx.Reviews) < 50 || len(fx.Reviews) > 300 {
		t.Errorf("expected ~1.5%% of %d matches reviewed (50-300 range); got %d", n, len(fx.Reviews))
	}

	// Each review should target a real match_key from the corpus.
	keys := make(map[string]bool, len(fx.Summaries))
	for _, s := range fx.Summaries {
		keys[s.MatchKey] = true
	}
	for _, r := range fx.Reviews {
		if !keys[r.MatchKey] {
			t.Fatalf("review references unknown match_key %s", r.MatchKey)
		}
		if r.ReviewedBy != "self" && r.ReviewedBy != "coach" {
			t.Fatalf("review carries invalid ReviewedBy %q (must be self or coach)", r.ReviewedBy)
		}
	}
}
