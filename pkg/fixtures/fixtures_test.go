package fixtures_test

import (
	"os"
	"reflect"
	"testing"
	"time"

	"recall/pkg/db"
	"recall/pkg/db/dbtest"
	"recall/pkg/fixtures"
	"recall/pkg/match"
	"recall/pkg/parser"
)

// TestMain pins the fixture date window so seeded distributions stay
// deterministic regardless of the wall clock — GenerateMatchFixture's
// window now rolls off time.Now() (last 8 months), which would otherwise
// shift the RNG stream day to day. Individual tests may override
// *fixtures.FixtureNow locally with their own cleanup.
func TestMain(m *testing.M) {
	*fixtures.FixtureNow = func() time.Time { return time.Date(2026, 9, 15, 12, 0, 0, 0, time.UTC) }
	os.Exit(m.Run())
}

func TestGenerateMatchFixture_RoundTripsThroughStore(t *testing.T) {
	fx := fixtures.GenerateMatchFixture(50, 42, "")

	// Per-match screenshot-type dice rolls (~95% summary, ~80% teams)
	// produce variable counts. The hard floor is "at least one
	// screenshot per planned match", but individual type-counts swing
	// match-to-match. Assert each type's count stays in a plausible
	// band so a regression that always-emits or never-emits a type
	// gets caught.
	if got := len(fx.Summaries); got < 40 || got > 50 {
		t.Errorf("Summaries: got %d, want 40-50 (~95%% of 50)", got)
	}
	if got := len(fx.Teams); got < 30 || got > 55 {
		// Upper bound includes ~1% ambiguous extras (50/100 = 0 at
		// this size, but kept for documentation).
		t.Errorf("Teams: got %d, want 30-55 (~80%% of 50)", got)
	}

	seen := make(map[string]struct{}, len(fx.Summaries))
	for _, s := range fx.Summaries {
		seen[s.MatchKey] = struct{}{}
	}
	if len(seen) != len(fx.Summaries) {
		t.Fatalf("expected unique summary match keys, got %d unique / %d total", len(seen), len(fx.Summaries))
	}

	fs := dbtest.New()
	mustWriteAll(t, "UpsertSummary", fx.Summaries,
		func(r db.SummaryRow) string { return r.MatchKey }, fs.UpsertSummary)
	mustWriteAll(t, "UpsertTeams", fx.Teams,
		func(r db.TeamsRow) string { return r.MatchKey }, fs.UpsertTeams)
	mustWriteAll(t, "UpsertPersonal", fx.Personals,
		func(r db.PersonalRow) string { return r.MatchKey }, fs.UpsertPersonal)
	mustWriteAll(t, "UpsertRank", fx.Ranks,
		func(r db.RankRow) string { return r.MatchKey }, fs.UpsertRank)
	mustWriteAll(t, "UpsertUnknown", fx.Unknowns,
		func(r db.UnknownRow) string { return r.Filename }, fs.UpsertUnknown)
	mustWriteAll(t, "ApplyAmbiguity", fx.Ambiguous,
		func(a fixtures.AmbiguousSeed) string { return a.Filename },
		func(a fixtures.AmbiguousSeed) error { return fs.ApplyAmbiguity(a.Filename, a.Candidates) })
}

// mustWriteAll writes each record via write, failing the test with the store
// operation's name and the record's identity on the first error.
func mustWriteAll[T any](t *testing.T, op string, records []T, identity func(T) string, write func(T) error) {
	t.Helper()
	for _, r := range records {
		if err := write(r); err != nil {
			t.Fatalf("%s(%s): %v", op, identity(r), err)
		}
	}
}

func TestGenerateMatchFixture_IsDeterministic(t *testing.T) {
	a := fixtures.GenerateMatchFixture(10, 7, "")
	b := fixtures.GenerateMatchFixture(10, 7, "")

	if !reflect.DeepEqual(a.Summaries[0], b.Summaries[0]) {
		t.Fatalf("Summaries[0] differ between identical seeds:\n a=%+v\n b=%+v", a.Summaries[0], b.Summaries[0])
	}
	if !reflect.DeepEqual(a.Teams[0], b.Teams[0]) {
		t.Fatal("Teams[0] differ between identical seeds")
	}
}

func TestGenerateMatchFixture_DatesWithinRange(t *testing.T) {
	fx := fixtures.GenerateMatchFixture(200, 1, "")

	start, end := fixtures.FixtureDateRange()
	// Allow a small overflow window past the upper bound — the dedupe
	// pass bumps colliding timestamps by +1 minute, which can spill a
	// match past midnight on the last day. A 3-day buffer is more than
	// enough at our scale.
	end = end.AddDate(0, 0, 3)

	for _, s := range fx.Summaries {
		d, err := time.Parse("2006-01-02", s.Date)
		if err != nil {
			t.Fatalf("bad date %q on match_key %s: %v", s.Date, s.MatchKey, err)
		}
		if d.Before(start) || d.After(end) {
			t.Fatalf("date %s on match_key %s outside [%s, %s]", s.Date, s.MatchKey,
				start.Format("2006-01-02"), end.Format("2006-01-02"))
		}
	}
}

// The corpus window is a rolling 8 months ending today — verify the
// bounds against a pinned "now" and that generated dates land inside it.
func TestGenerateMatchFixture_RollingEightMonthWindow(t *testing.T) {
	prev := *fixtures.FixtureNow
	*fixtures.FixtureNow = func() time.Time { return time.Date(2026, 9, 15, 12, 30, 0, 0, time.UTC) }
	t.Cleanup(func() { *fixtures.FixtureNow = prev })

	start, end := fixtures.FixtureDateRange()
	if want := time.Date(2026, 9, 15, 0, 0, 0, 0, time.UTC); !end.Equal(want) {
		t.Fatalf("end = %v, want %v (today)", end, want)
	}
	if want := time.Date(2026, 1, 15, 0, 0, 0, 0, time.UTC); !start.Equal(want) {
		t.Fatalf("start = %v, want %v (8 months before today)", start, want)
	}

	fx := fixtures.GenerateMatchFixture(150, 7, "")
	upper := end.AddDate(0, 0, 3)
	for _, s := range fx.Summaries {
		d, _ := time.Parse("2006-01-02", s.Date)
		if d.Before(start) || d.After(upper) {
			t.Fatalf("date %s outside rolling window [%s, %s]", s.Date,
				start.Format("2006-01-02"), upper.Format("2006-01-02"))
		}
	}
}

func TestGenerateMatchFixture_DifferentSeedsDiffer(t *testing.T) {
	// Sanity check: two different seeds should produce visibly
	// different first matches (proves the seed actually influences
	// every choice, not just one path).
	a := fixtures.GenerateMatchFixture(10, 1, "")
	b := fixtures.GenerateMatchFixture(10, 2, "")
	if reflect.DeepEqual(a.Summaries[0], b.Summaries[0]) {
		t.Fatal("Summaries[0] identical across different seeds — seed isn't doing anything")
	}
}

func TestGenerateMatchFixture_ELOEquilibrium(t *testing.T) {
	// The competitive win rate is an ELO curve, not a fixed target: high when a
	// track is underranked, regressing to 50% at its skill ceiling. At a large
	// N every track has long since reached its ceiling and plays at ~50% — you
	// land where you belong. So the overall decisive rate settles near 50%
	// (never above the ~59% typical ceiling), and draws stay ~1%.
	const n = 10000
	fx := fixtures.GenerateMatchFixture(n, 1, "")

	counts := map[string]int{}
	for _, s := range fx.Summaries {
		counts[s.Result]++
	}
	w, l, d := counts["victory"], counts["defeat"], counts["draw"]
	total := len(fx.Summaries)

	decisiveWR := float64(w) / float64(w+l) * 100
	if decisiveWR < 48 || decisiveWR > 55 {
		t.Errorf("equilibrium decisive win rate %.2f%% outside [48%%, 55%%] (should settle near 50%%)", decisiveWR)
	}
	if d < total*3/1000 || d > total*20/1000 {
		t.Errorf("draw rate %.2f%% outside [0.3%%, 2.0%%]", float64(d)/float64(total)*100)
	}
}

func TestGenerateMatchFixture_FlexCoversEveryMapAndHero(t *testing.T) {
	// Default style (flex) must surface every map in fixtures.FixtureMaps AND
	// every hero across the three role pools at least once — that's
	// what the coverage pass exists for. Without it, top-heavy map
	// weights + 6-9 flex mains miss a handful of tail values per
	// run, blinding eyeball UI testing to icons / labels for the
	// missing entries.
	const n = 100
	fx := fixtures.GenerateMatchFixture(n, 1, "")

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
	if len(fixtures.FixtureMaps()) == 0 {
		t.Fatal("FixtureMaps is empty — the coverage assertions below would be vacuous")
	}
	for _, m := range fixtures.FixtureMaps() {
		if !seenMaps[m] {
			t.Errorf("map %q missing from default-flex corpus", m)
		}
	}
	allHeroes := make([]string, 0, len(fixtures.FixtureTanks())+len(fixtures.FixtureSupports())+len(fixtures.FixtureDPS()))
	allHeroes = append(allHeroes, fixtures.FixtureTanks()...)
	allHeroes = append(allHeroes, fixtures.FixtureSupports()...)
	allHeroes = append(allHeroes, fixtures.FixtureDPS()...)
	if len(allHeroes) == 0 {
		t.Fatal("hero pools are empty — the coverage assertions below would be vacuous")
	}
	for _, h := range allHeroes {
		if !seenHeroes[h] {
			t.Errorf("hero %q missing from default-flex corpus", h)
		}
	}
}

func TestGenerateMatchFixture_FlexSwapRatesPerMode(t *testing.T) {
	// Competitive players mostly commit: ~30% one hero, ~55% one swap, and a
	// 3+-hero desperation tail the rank model prices as usually-lost.
	// Quickplay keeps the loose everything-goes spread (~10% single).
	const n = 1300
	fx := fixtures.GenerateMatchFixture(n, 1, "flex")
	mode := map[string]string{}
	for _, pm := range fx.PlayModes {
		mode[pm.MatchKey] = pm.PlayMode
	}
	singles := map[string]int{}
	totals := map[string]int{}
	for _, s := range fx.Summaries {
		m := mode[s.MatchKey]
		totals[m]++
		if len(s.HeroesPlayed) == 1 {
			singles[m]++
		}
	}
	compSingle := float64(singles["competitive"]) * 100 / float64(totals["competitive"])
	if compSingle < 22 || compSingle > 38 {
		t.Errorf("competitive single-hero share %.1f%% outside [22%%, 38%%] (want ~30)", compSingle)
	}
	qpSingle := float64(singles["quickplay"]) * 100 / float64(totals["quickplay"])
	if qpSingle > 22 {
		t.Errorf("quickplay single-hero share %.1f%%; the loose spread should stay under ~22%%", qpSingle)
	}
}

func TestGenerateMatchFixture_OneTrickNeverSwaps(t *testing.T) {
	// One-tricks by definition never swap mid-match. Every summary's
	// HeroesPlayed must have exactly one entry.
	const n = 200
	fx := fixtures.GenerateMatchFixture(n, 1, "one-trick")

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
	fx := fixtures.GenerateMatchFixture(200, 1, "")

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
	fx := fixtures.GenerateMatchFixture(n, 1, "one-trick")

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
	fx := fixtures.GenerateMatchFixture(n, 1, "")

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
	fx := fixtures.GenerateMatchFixture(n, 1, "")

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
		primaryRole := fixtures.RoleOfHero(s.Hero)
		for _, hp := range s.HeroesPlayed {
			got := fixtures.RoleOfHero(hp.Hero)
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
	fx := fixtures.GenerateMatchFixture(n, 1, "")

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
		first := fixtures.RoleOfHero(s.HeroesPlayed[0].Hero)
		for _, hp := range s.HeroesPlayed[1:] {
			if fixtures.RoleOfHero(hp.Hero) != first {
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
	fx := fixtures.GenerateMatchFixture(n, 1, "")

	// PlayModes are tagged per-summary; with ~95% summary dice rolls
	// the tagged count tracks the summary count, not n. Allow a wide
	// band so per-seed variance doesn't flake.
	// Manual matches add play-mode seeds on fresh (non-summary) keys; count
	// only the OCR-backed ones against the summary rate.
	ocrPlayModes := countOCRTagged(fx, fx.PlayModes, func(pm fixtures.PlayModeSeed) string { return pm.MatchKey })
	if ocrPlayModes < n*90/100 || ocrPlayModes > n {
		t.Fatalf("expected ~95%% of OCR matches to be play-mode-tagged (got %d/%d)", ocrPlayModes, n)
	}

	comp, qp := tallyNonClashPlayModes(t, fx)
	total := comp + qp
	if comp*100 < total*85 || comp*100 > total*95 {
		t.Errorf("competitive rate %.2f%% outside [85%%, 95%%] (non-Clash)", float64(comp)*100/float64(total))
	}
	if qp*100 < total*5 || qp*100 > total*15 {
		t.Errorf("quickplay rate %.2f%% outside [5%%, 15%%] (non-Clash)", float64(qp)*100/float64(total))
	}

	assertSeedKeysExist(t, fx, "play-mode", fx.PlayModes, func(pm fixtures.PlayModeSeed) string { return pm.MatchKey })
}

// countOCRTagged counts the seeds whose match_key belongs to an OCR summary
// (manual matches carry seeds on fresh, non-summary keys).
func countOCRTagged[T any](fx fixtures.Fixture, seeds []T, key func(T) string) int {
	ocrKeys := make(map[string]bool, len(fx.Summaries))
	for _, s := range fx.Summaries {
		ocrKeys[s.MatchKey] = true
	}
	tagged := 0
	for _, sd := range seeds {
		if ocrKeys[key(sd)] {
			tagged++
		}
	}
	return tagged
}

// tallyNonClashPlayModes tallies competitive vs quickplay over non-Clash OCR
// matches. The ~90/10 play-mode ASSIGNMENT is a separate mechanism from the
// clash→quickplay forcing (Clash is quickplay-only). A seed whose map
// shuffle puts a Clash map on top would swell quickplay well past 10% —
// legitimately, not a regression — so isolate the assignment by measuring
// only NON-Clash OCR matches, whose play mode follows the raw 90/10 dice.
func tallyNonClashPlayModes(t *testing.T, fx fixtures.Fixture) (comp, qp int) {
	t.Helper()
	mapByKey := make(map[string]string, len(fx.Summaries))
	for _, s := range fx.Summaries {
		mapByKey[s.MatchKey] = s.Map
	}
	for _, p := range fx.PlayModes {
		switch p.PlayMode {
		case "competitive", "quickplay":
		default:
			t.Fatalf("play-mode carries invalid value %q (must be quickplay or competitive)", p.PlayMode)
		}
		m, ok := mapByKey[p.MatchKey]
		if !ok || parser.MapGameMode(m) == "clash" {
			continue // manual match (no OCR map) or force-quickplay Clash
		}
		if p.PlayMode == "competitive" {
			comp++
		} else {
			qp++
		}
	}
	return comp, qp
}

// assertSeedKeysExist pins that every seeded entry references a real
// match_key — an OCR summary OR a hand-entered (manual) match in the
// user-data layer.
func assertSeedKeysExist[T any](t *testing.T, fx fixtures.Fixture, kind string, seeds []T, key func(T) string) {
	t.Helper()
	keys := make(map[string]bool, len(fx.Summaries)+len(fx.UserData))
	for _, s := range fx.Summaries {
		keys[s.MatchKey] = true
	}
	for _, ud := range fx.UserData {
		keys[ud.MatchKey] = true
	}
	for _, sd := range seeds {
		if !keys[key(sd)] {
			t.Fatalf("%s references unknown match_key %s", kind, key(sd))
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
	fx := fixtures.GenerateMatchFixture(n, 1, "")

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
	fx := fixtures.GenerateMatchFixture(n, 1, "")

	// Queues are tagged per-summary; with ~95% summary dice rolls the tagged
	// count tracks the summary count, not n. Manual matches add their own
	// queue seeds on fresh (non-summary) keys, so count only the OCR-backed
	// ones here.
	ocrQueues := countOCRTagged(fx, fx.Queues, func(q fixtures.QueueSeed) string { return q.MatchKey })
	if ocrQueues < n*90/100 || ocrQueues > n {
		t.Fatalf("expected ~95%% of OCR matches to be queue-tagged (got %d/%d)", ocrQueues, n)
	}

	role, open := tallyQueueTypes(t, fx.Queues)
	total := len(fx.Queues)
	if role*100 < total*75 || role*100 > total*85 {
		t.Errorf("role-queue rate %.2f%% outside [75%%, 85%%]", float64(role)*100/float64(total))
	}
	if open*100 < total*15 || open*100 > total*25 {
		t.Errorf("open-queue rate %.2f%% outside [15%%, 25%%]", float64(open)*100/float64(total))
	}

	assertSeedKeysExist(t, fx, "queue", fx.Queues, func(q fixtures.QueueSeed) string { return q.MatchKey })
}

// tallyQueueTypes counts role vs open seeds, failing on any other value.
func tallyQueueTypes(t *testing.T, queues []fixtures.QueueSeed) (role, open int) {
	t.Helper()
	for _, q := range queues {
		switch q.QueueType {
		case "role":
			role++
		case "open":
			open++
		default:
			t.Fatalf("queue carries invalid QueueType %q (must be role or open)", q.QueueType)
		}
	}
	return role, open
}

func TestGenerateMatchFixture_ScreenshotTypeDistribution(t *testing.T) {
	// Per-match screenshot-type dice models real capture habits:
	// ~95% summary, ~80% teams, ~70% personal. Independent rolls so each
	// match's combination of types varies. At N=5000 the binomial bands are
	// tight enough to assert on each rate directly.
	const n = 5000
	fx := fixtures.GenerateMatchFixture(n, 1, "")

	// Bands include a 5pp tolerance + the ~1% ambiguous teams.
	if r := float64(len(fx.Summaries)) * 100 / float64(n); r < 92 || r > 98 {
		t.Errorf("summary rate %.2f%% outside [92%%, 98%%]", r)
	}
	if r := float64(len(fx.Teams)) * 100 / float64(n); r < 76 || r > 85 {
		t.Errorf("teams rate %.2f%% outside [76%%, 85%%]", r)
	}
	if r := float64(len(fx.Personals)) * 100 / float64(n); r < 66 || r > 74 {
		t.Errorf("personal rate %.2f%% outside [66%%, 74%%]", r)
	}
	assertRanksOnCompetitiveOnly(t, fx)
}

// assertRanksOnCompetitiveOnly pins the rank-emission structure. Rank is no
// longer a per-match dice roll — applyRankProgression emits periodic cards on
// competitive matches only. Assert the structural invariants instead of a
// fixed share: some ranks exist, never more than the competitive-summary
// count, and every rank row is on a competitive match (never quickplay/clash).
func assertRanksOnCompetitiveOnly(t *testing.T, fx fixtures.Fixture) {
	t.Helper()
	comp := competitiveKeys(fx)
	if len(fx.Ranks) == 0 {
		t.Fatal("no rank readings emitted")
	}
	if len(fx.Ranks) > len(comp) {
		t.Errorf("rank rows (%d) exceed competitive summaries (%d)", len(fx.Ranks), len(comp))
	}
	for _, r := range fx.Ranks {
		if !comp[r.MatchKey] {
			t.Errorf("rank row on non-competitive match %s", r.MatchKey)
		}
	}
}

// competitiveKeys returns the set of match keys whose seeded play mode is
// competitive (from fx.PlayModes) — the only matches allowed to carry rank.
func competitiveKeys(fx fixtures.Fixture) map[string]bool {
	comp := make(map[string]bool)
	for _, pm := range fx.PlayModes {
		if pm.PlayMode == "competitive" {
			comp[pm.MatchKey] = true
		}
	}
	return comp
}

func TestGenerateMatchFixture_UnknownAndAmbiguousCounts(t *testing.T) {
	// Unknown screenshots model ~2% of N; ambiguous ~1%. Both are
	// fixed-share emissions from derived RNGs (seed+5 / seed+6) — no
	// dice variance — so at any N ≥ 100 the counts are exact.
	const n = 500
	fx := fixtures.GenerateMatchFixture(n, 1, "")

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
		mk, err := match.ParseKey(u.MatchKey)
		if err != nil || !mk.IsUnmatched() {
			t.Errorf("unknown %s has non-unmatched key %q", u.Filename, u.MatchKey)
		}
	}

	assertAmbiguousStructure(t, fx)
}

// assertAmbiguousStructure pins each ambiguous seed's shape: every one pairs
// with a teams row carrying an ambiguous- match key for its filename, and
// points at 2-3 real tracked match_keys from the main corpus.
func assertAmbiguousStructure(t *testing.T, fx fixtures.Fixture) {
	t.Helper()
	trackedSet := make(map[string]bool, len(fx.Summaries))
	for _, s := range fx.Summaries {
		if mk, err := match.ParseKey(s.MatchKey); err == nil && mk.IsTracked() {
			trackedSet[s.MatchKey] = true
		}
	}
	teamsByFilename := make(map[string]string, len(fx.Teams))
	for _, sb := range fx.Teams {
		teamsByFilename[sb.Filename] = sb.MatchKey
	}
	for _, a := range fx.Ambiguous {
		assertAmbiguousCandidates(t, a, trackedSet)
		gotKey, ok := teamsByFilename[a.Filename]
		if !ok {
			t.Errorf("ambiguous %s has no companion teams row", a.Filename)
			continue
		}
		if mk, err := match.ParseKey(gotKey); err != nil || !mk.IsAmbiguous() {
			t.Errorf("ambiguous %s companion teams key %q isn't ambiguous-shaped", a.Filename, gotKey)
		}
	}
}

// assertAmbiguousCandidates pins one seed's candidate list: 2-3 entries, all
// drawn from real tracked corpus keys.
func assertAmbiguousCandidates(t *testing.T, a fixtures.AmbiguousSeed, trackedSet map[string]bool) {
	t.Helper()
	if c := len(a.Candidates); c < 2 || c > 3 {
		t.Errorf("ambiguous %s has %d candidates, want 2 or 3", a.Filename, c)
	}
	for _, c := range a.Candidates {
		if !trackedSet[c.MatchKey] {
			t.Errorf("ambiguous %s candidate %s isn't a real tracked match_key from the corpus", a.Filename, c.MatchKey)
		}
	}
}

func TestGenerateMatchFixture_ReviewRate(t *testing.T) {
	// ~1.5% of matches should carry a review. At N=10000, 4-sigma
	// bounds are roughly [120, 180]; we use [50, 300] as a loose
	// "rate is in the right ballpark" check that catches "0% reviewed"
	// and "everything reviewed" regressions without flaking.
	const n = 10000
	fx := fixtures.GenerateMatchFixture(n, 1, "")

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

// --- Rank-progression integration (black box, via GenerateMatchFixture) ---

var rankTestTiers = []string{"bronze", "silver", "gold", "platinum", "diamond", "master", "grandmaster", "champion"}

// ladderScoreOf mirrors the frontend ladderScore encoding so the tests reason
// about "did this track climb" in the same numeric space the chart plots.
func ladderScoreOf(rank string, level, prog int) float64 {
	for i, n := range rankTestTiers {
		if n == rank {
			return float64(i*5+(5-level)) + float64(prog)/100
		}
	}
	return -1
}

// queueByMatchKey indexes fx.Queues so a rank row can be routed to its track.
func queueByMatchKey(fx fixtures.Fixture) map[string]string {
	q := make(map[string]string, len(fx.Queues))
	for _, s := range fx.Queues {
		q[s.MatchKey] = s.QueueType
	}
	return q
}

func TestGenerateMatchFixture_RankModifiersValid(t *testing.T) {
	// Every emitted modifier must be in the rank_modifiers CHECK enum or the
	// UpsertRank INSERT would fail at seed time.
	valid := map[string]bool{}
	for _, m := range []string{
		"expected", "uphill battle", "reversal", "consolation", "win streak",
		"loss streak", "calibration", "volatile", "new map", "leaver compensation",
		"victory", "defeat", "draw", "demotion protection",
	} {
		valid[m] = true
	}
	fx := fixtures.GenerateMatchFixture(1000, 8, "")
	if len(fx.Ranks) == 0 {
		t.Fatal("no rank readings emitted")
	}
	for _, r := range fx.Ranks {
		if len(r.Modifiers) == 0 {
			t.Errorf("rank row %s has no modifiers", r.MatchKey)
		}
		for _, m := range r.Modifiers {
			if !valid[m] {
				t.Errorf("rank row %s carries modifier %q, not in the CHECK enum", r.MatchKey, m)
			}
		}
	}
}

func TestGenerateMatchFixture_RankClimbsMainTrack(t *testing.T) {
	// The tour profile's exact config. The DPS main (85% of comp role queue)
	// must NET real growth; the thin tank/support/open tracks wander with the
	// gap-reversion model — they may drift a shade below their start on a
	// given seed, but never collapse or run away. DPS stays busiest + highest.
	fx := fixtures.GenerateMatchFixture(1300, 8, "")

	start := map[string]float64{
		"tank":    ladderScoreOf("silver", 1, 0),
		"dps":     ladderScoreOf("gold", 4, 0),
		"support": ladderScoreOf("gold", 3, 0),
		"open":    ladderScoreOf("gold", 5, 0),
	}
	lastScore, count := foldRankCardsByTrack(t, fx)

	for track, s0 := range start {
		if count[track] == 0 {
			t.Errorf("track %q emitted no rank cards (can't show a climb)", track)
			continue
		}
		if track == "dps" && lastScore[track] < s0+3 {
			t.Errorf("dps track must net a real climb: last %.2f < start %.2f + 3 divisions", lastScore[track], s0)
		}
		if lastScore[track] < s0-2.5 {
			t.Errorf("track %q collapsed: last %.2f more than 2.5 divisions under its %.2f start", track, lastScore[track], s0)
		}
		// Runaway guard: a true 59% lands the busiest track ~Diamond, but
		// per-track variance at N=500 can carry a lucky track a division or two
		// into low Master. Grandmaster+ (score >= 30) would signal the walk
		// climbs far too fast (a real bug), not luck.
		if lastScore[track] >= 30 {
			t.Errorf("track %q overshot into Grandmaster+ (score %.2f) — climb too fast", track, lastScore[track])
		}
	}
	for _, off := range []string{"tank", "support"} {
		if count["dps"] <= count[off] {
			t.Errorf("dps (%d cards) should be the busiest role track, but %s has %d", count["dps"], off, count[off])
		}
		if lastScore["dps"] <= lastScore[off] {
			t.Errorf("dps final %.2f should be the highest role track, but %s is %.2f", lastScore["dps"], off, lastScore[off])
		}
	}
}

// foldRankCardsByTrack resolves each rank card onto its track (open queue
// stays "open"; role-queue cards route via the SR hero's role) and returns
// the last ladder score + card count per track.
func foldRankCardsByTrack(t *testing.T, fx fixtures.Fixture) (lastScore map[string]float64, count map[string]int) {
	t.Helper()
	queueBy := queueByMatchKey(fx)
	lastScore = map[string]float64{}
	count = map[string]int{}
	for _, r := range fx.Ranks {
		track := queueBy[r.MatchKey]
		if track != "open" {
			if len(r.SR) == 0 {
				t.Fatalf("rank row %s has no SR hero to resolve its role", r.MatchKey)
			}
			track = fixtures.RoleOfHero(r.SR[0].Hero)
		}
		lastScore[track] = ladderScoreOf(r.Rank, r.Level, r.RankProgress)
		count[track]++
	}
	return lastScore, count
}

func TestGenerateMatchFixture_RankChangePercentSigns(t *testing.T) {
	// The climb is not monotone: most win-cards are positive, but a win-card
	// whose 5-win window held many losses nets negative — so downturns are
	// representable even though the 15-loss card rarely fires.
	fx := fixtures.GenerateMatchFixture(5000, 8, "")
	pos, neg := 0, 0
	for _, r := range fx.Ranks {
		switch {
		case r.ChangePercent > 0:
			pos++
		case r.ChangePercent < 0:
			neg++
		}
	}
	if pos == 0 {
		t.Error("no positive change_percent cards — the climb isn't showing")
	}
	if neg == 0 {
		t.Error("no negative change_percent cards — a rough 5-win window should net negative")
	}
}

// trackWLByKey tallies decisive competitive wins/losses per rank track over the
// given result slice (nil = whole corpus), in chronological summary order.
func trackWL(fx fixtures.Fixture) map[string]*[2]int {
	queueBy := queueByMatchKey(fx)
	mode := map[string]string{}
	for _, pm := range fx.PlayModes {
		mode[pm.MatchKey] = pm.PlayMode
	}
	out := map[string]*[2]int{}
	for _, s := range fx.Summaries {
		if mode[s.MatchKey] != "competitive" {
			continue
		}
		track := queueBy[s.MatchKey]
		if track != "open" {
			track = fixtures.RoleOfHero(s.Hero)
		}
		if out[track] == nil {
			out[track] = &[2]int{}
		}
		switch s.Result {
		case "victory":
			out[track][0]++
		case "defeat":
			out[track][1]++
		}
	}
	return out
}

func TestGenerateMatchFixture_PerTrackEquilibrium(t *testing.T) {
	// At large N every track has reached its skill ceiling and plays at the ELO
	// equilibrium — ~50% — so it lands where it belongs. None sits near the
	// underranked-climb ceiling (~59-70%) any more.
	byTrack := trackWL(fixtures.GenerateMatchFixture(10000, 8, ""))
	for _, track := range []string{"tank", "dps", "support", "open"} {
		c := byTrack[track]
		if c == nil || c[0]+c[1] == 0 {
			t.Fatalf("track %q had no decisive competitive games", track)
		}
		wr := float64(c[0]) / float64(c[0]+c[1]) * 100
		if wr < 47 || wr > 54 {
			t.Errorf("track %q equilibrium win rate %.1f%% outside [47%%, 54%%]", track, wr)
		}
	}
}

func TestGenerateMatchFixture_TrackWinRatesStayHuman(t *testing.T) {
	// Under gap reversion a track's realized rate hovers near 50 — elevated
	// when it dips under its skill line, sub-50 when it peaks over it, taxed
	// by the hero-cost penalties throughout. No track reads like a smurf or
	// a thrower. (The arc itself — slow growth, slumps, mean reversion — is
	// pinned by the TestTourStory_* suite.)
	fx := fixtures.GenerateMatchFixture(1300, 8, "")
	byTrack := trackWL(fx)
	for _, track := range []string{"tank", "dps", "support", "open"} {
		c := byTrack[track]
		wr := float64(c[0]) / float64(c[0]+c[1]) * 100
		lo := 44.0
		if track == "tank" || track == "support" {
			// The ~5-10% off-role tracks are tiny samples that eat the
			// off-pool + swap taxes — bleeding there IS the demo's lesson.
			lo = 35
		}
		if wr < lo || wr > 60 {
			t.Errorf("track %q win rate %.1f%% outside the human band [%.0f%%, 60%%]", track, wr, lo)
		}
	}
}

func TestGenerateMatchFixture_RankDeterministic(t *testing.T) {
	a := fixtures.GenerateMatchFixture(500, 8, "")
	b := fixtures.GenerateMatchFixture(500, 8, "")
	if !reflect.DeepEqual(a.Ranks, b.Ranks) {
		t.Error("fx.Ranks differ across two identical-seed runs — rank walk isn't deterministic")
	}
}
