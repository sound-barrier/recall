package app

// Correlation stress dataset — 400 synthesized screenshot fixtures
// across 11 cohorts that exercise every branch of resolveMatchKey.
//
// Goal: pin every behavior (correct and buggy) of the resolver so a
// future PR that fixes the matcher has to update the test, and a
// regression that re-breaks a previously-fixed case fails CI
// immediately.
//
// Each cohort lives in its own test function so a fix targeted at
// (say) the EAD-bridge bug can update just that cohort. Cohort
// counts:
//
//   A. Baseline clean ............................ 100   (25 matches × 4 types)
//   B. EAD-bridge across distant time ............. 40   (10 pairs × 2 screenshots × 2)
//   C. Same-hero back-to-back, different EAD ...... 40   (10 pairs × 2 screenshots × 2)
//   D. Same-hero back-to-back, identical EAD ...... 40   (10 pairs × 2 screenshots × 2)
//   E. Timestamp-window 90s edge .................. 40   (8 pairs × 5 screenshots)
//   F. Multi-hero match — TEAMS swap ......... 40   (10 matches × 4 screenshots)
//   G. Multi-hero match — 2 PERSONALs swap ........ 20   (5 matches × 4 screenshots)
//   H. RANK adoption (clean) ...................... 30   (10 matches × 3 screenshots)
//   I. Zero-stat teams ....................... 20   (5 matches × 4 screenshots)
//   J. Unparseable filename timestamps ............ 15   (15 PERSONALs with no ts)
//   K. Identical filename timestamps (duplicates) . 15   (5 triples)
//                                                  ──────
//                                            Total  400
//
// Buggy expectations are flagged via `matchSpec.bugNote`. Run the
// dataset with `go test -run TestCorrelation_Stress -v ./pkg/app/`
// and the bug count rolls up per-cohort in the log output.

import (
	"fmt"
	"testing"
	"time"

	"recall/pkg/parser"
)

// owMaps + owHeroes are non-colliding rosters big enough for the
// largest cohort. Picked from `pkg/parser/maps.yaml` and
// `heroes.yaml` so the names round-trip through the production hero
// + map normalisers.
var owMaps = []string{
	"rialto", "lijiang tower", "numbani", "oasis", "ilios",
	"hollywood", "kings row", "junkertown", "route 66", "watchpoint gibraltar",
	"havana", "nepal", "busan", "esperanca", "new junk city",
	"colosseo", "circuit royal", "blizzard world", "antarctic peninsula", "samoa",
	"midtown", "paraiso", "shambali monastery", "throne of anubis", "suravasa",
}

var owHeroes = []string{
	"lucio", "mercy", "kiriko", "ana", "zenyatta", "moira",
	"juno", "illari", "lifeweaver", "brigitte", "baptiste",
	"reinhardt", "winston", "zarya", "sigma", "orisa", "dva",
	"mauga", "ramattra", "doomfist", "junker queen", "roadhog",
	"soldier", "tracer", "genji", "reaper", "mei", "sojourn",
	"ashe", "bastion", "cassidy", "echo", "hanzo", "junkrat",
	"pharah", "sombra", "symmetra", "torbjorn", "venture", "widowmaker",
	"wuyang", "freja", "hazard",
}

var owMatchTypes = []string{"control", "escort", "hybrid", "push", "flashpoint", "clash"}

var owRoles = []string{"tank", "support", "dps"}

var owResults = []string{"victory", "defeat", "draw"}

// pickAt cycles a slice by the given index. Cohorts that want stable
// data across runs use this to derive map/hero/mode/etc. assignments.
func pickAt[T any](slice []T, idx int) T {
	return slice[idx%len(slice)]
}

// ─────────────────────────────────────────────────────────────────
// COHORT A — baseline clean.
//
// 25 matches, well-separated in time, single-hero each. Every match
// emits SUMMARY → TEAMS → PERSONAL → RANK. Standard offsets
// (0s, 30s, 45s, 90s after the match anchor). EAD signatures are
// unique per match so EAD-bridge can never collide. Result keys
// derive directly from each match's startTime.
//
// What this cohort proves:
//   - SUMMARY mints the canonical match_key for its match.
//   - TEAMS adopts SUMMARY's key via EAD-bridge OR timestamp
//     window (either path qualifies here).
//   - PERSONAL adopts via timestamp window (PERSONAL has no EAD).
//   - RANK adopts via timestamp window (RANK has no map).
//
// No bug expectations. Every fixture's expected key is the match's
// own anchor.
// ─────────────────────────────────────────────────────────────────

func TestCorrelation_Stress_BaselineClean(t *testing.T) {
	base := mustParseTS("Overwatch 2 Screenshot 2026.05.10 - 14.00.00")
	const spacing = 10 * time.Minute

	specs := make([]matchSpec, 0, 25)
	for i := 0; i < 25; i++ {
		start := base.Add(time.Duration(i) * spacing)
		specs = append(specs, matchSpec{
			startTime:         start,
			mapName:           pickAt(owMaps, i),
			mode:              "competitive",
			matchType:         pickAt(owMatchTypes, i),
			role:              pickAt(owRoles, i),
			primaryHero:       pickAt(owHeroes, i),
			eliminations:      10 + i,
			assists:           4 + (i % 5),
			deaths:            3 + (i % 4),
			damage:            5000 + 100*i,
			healing:           2000 + 50*i,
			mitigation:        1000 + 30*i,
			result:            pickAt(owResults, i),
			finalScore:        "3-2",
			date:              start.Format("01/02/2006"),
			finishedAt:        start.Add(45 * time.Second).Format("15:04"),
			gameLength:        "12:34",
			rankBand:          "diamond",
			rankLevel:         3,
			rankProgress:      40 + i,
			rankChange:        24,
			rankResult:        "victory",
			emitSummary:       true,
			emitTeams:         true,
			emitPersonal:      true,
			emitRank:          true,
			useDefaultOffsets: true,
			suffix:            fmt.Sprintf("A%02d", i),
			expectedKey:       matchKeyFor(start),
			heroesPlayed: []parser.HeroPlay{
				{Hero: pickAt(owHeroes, i), PercentPlayed: 100, PlayTime: "12:34"},
			},
		})
	}

	fixtures := make([]fixture, 0, 100)
	for _, s := range specs {
		fixtures = append(fixtures, buildFixtures(s)...)
	}
	if got, want := len(fixtures), 100; got != want {
		t.Fatalf("cohort A fixture count: got %d, want %d", got, want)
	}
	runStressCohort(t, "A-baseline-clean", fixtures)
}

// ─────────────────────────────────────────────────────────────────
// COHORT B — EAD-bridge across distant time.
//
// 10 pairs of matches MANY days apart that happen to share the same
// (E, A, D) signature on the same map + hero. PR #104 time-bounded
// the EAD-bridge to 30 minutes, so Y no longer adopts X's key — Y
// mints its own anchor from Y's filename timestamp. (Before the fix,
// the time-blind bridge silently merged Y into X.)
//
// Pattern per pair:
//   Match X (anchor day)         → SUMMARY x:00, TEAMS x:30
//   Match Y (7–16 days later)    → TEAMS y−10s (first), SUMMARY y
//     - Y TEAMS: EAD bridge sees X but X is >30m away, refuses.
//       Mints fresh key matchKeyFor(y−10s).
//     - Y SUMMARY: no EAD on summary side; falls into timestamp window
//       and adopts the just-inserted Y TEAMS key (10s away).
//
// Per-pair fixture count: 2 screenshots × 2 matches = 4 fixtures.
// 40 total; 0 buggy pins remaining.
// ─────────────────────────────────────────────────────────────────

func TestCorrelation_Stress_EADBridgeDistantTime(t *testing.T) {
	base := mustParseTS("Overwatch 2 Screenshot 2026.05.10 - 14.00.00")
	specs := make([]matchSpec, 0, 20)
	for i := 0; i < 10; i++ {
		x := base.Add(time.Duration(i*15) * time.Minute)
		y := x.Add(time.Duration(7+i) * 24 * time.Hour) // 7-16 days later
		mapName := pickAt(owMaps, i)
		hero := pickAt(owHeroes, i)
		e, a, d := 17+i, 9+i, 4+i

		// Match X — fresh, clean attribution.
		specs = append(specs, matchSpec{
			startTime:    x,
			mapName:      mapName,
			mode:         "competitive",
			matchType:    pickAt(owMatchTypes, i),
			role:         pickAt(owRoles, i),
			primaryHero:  hero,
			eliminations: e, assists: a, deaths: d,
			damage: 6000, healing: 2500, mitigation: 1200,
			result:            "victory",
			date:              x.Format("01/02/2006"),
			finishedAt:        x.Add(45 * time.Second).Format("15:04"),
			emitSummary:       true,
			emitTeams:         true,
			useDefaultOffsets: true,
			suffix:            fmt.Sprintf("B%02dx", i),
			expectedKey:       matchKeyFor(x),
		})

		// Match Y — no longer adopts X (>30m gap blocks the bridge).
		// TEAMS is emitted at y−10s; SUMMARY at y. Both adopt the
		// fresh TEAMS-anchor key.
		specs = append(specs, matchSpec{
			startTime:    y,
			mapName:      mapName,
			mode:         "competitive",
			matchType:    pickAt(owMatchTypes, i),
			role:         pickAt(owRoles, i),
			primaryHero:  hero,
			eliminations: e, assists: a, deaths: d,
			damage: 7000, healing: 2700, mitigation: 1300,
			result:      "victory",
			date:        y.Format("01/02/2006"),
			finishedAt:  y.Add(45 * time.Second).Format("15:04"),
			emitSummary: true,
			emitTeams:   true,
			suffix:      fmt.Sprintf("B%02dy", i),
			expectedKey: matchKeyFor(y.Add(-10 * time.Second)),
		})
	}

	// Match Y's SUMMARY and Match Y's TEAMS both inherit the
	// bug. The expected `date` field differs between X and Y, but
	// rowsConflict() refuses to bridge when BOTH sides have a date
	// and they differ — so the production resolver actually REJECTS
	// the bridge once SUMMARY's date populates. Strip date from
	// a TEAMS MatchResult (it's not parsed from teams) to
	// model the in-game scenario where TEAMS comes first.
	//
	// For honest pinning we emit TEAMS before SUMMARY for the
	// Y match — that way the TEAMS has no date, EAD-bridge
	// fires, and X's key gets adopted.
	fixtures := make([]fixture, 0, 40)
	for i, s := range specs {
		// X specs (even idx): emit SUMMARY first then TEAMS.
		// Y specs (odd idx): emit TEAMS first (no date) so the
		// EAD-bridge bug actually triggers, then SUMMARY which will
		// hit the same bridge via the TEAMS it just inserted.
		if i%2 == 1 {
			// TEAMS comes first for Y.
			fxs := buildFixtures(matchSpec{
				startTime:    s.startTime,
				mapName:      s.mapName,
				mode:         s.mode,
				matchType:    s.matchType,
				role:         s.role,
				primaryHero:  s.primaryHero,
				eliminations: s.eliminations,
				assists:      s.assists,
				deaths:       s.deaths,
				damage:       s.damage,
				healing:      s.healing,
				mitigation:   s.mitigation,
				emitTeams:    true,
				teamsOffset:  -10 * time.Second, // before SUMMARY's anchor
				suffix:       s.suffix,
				expectedKey:  s.expectedKey,
				bugNote:      s.bugNote,
			})
			fixtures = append(fixtures, fxs...)
			// Then SUMMARY (which will adopt the TEAMS we just inserted).
			fxs = buildFixtures(matchSpec{
				startTime:    s.startTime,
				mapName:      s.mapName,
				mode:         s.mode,
				primaryHero:  s.primaryHero,
				eliminations: s.eliminations, assists: s.assists, deaths: s.deaths,
				result:      "victory",
				date:        s.date,
				finishedAt:  s.finishedAt,
				emitSummary: true,
				suffix:      s.suffix,
				expectedKey: s.expectedKey,
				bugNote:     s.bugNote,
				heroesPlayed: []parser.HeroPlay{
					{Hero: s.primaryHero, PercentPlayed: 100, PlayTime: "12:34"},
				},
			})
			fixtures = append(fixtures, fxs...)
			continue
		}
		fixtures = append(fixtures, buildFixtures(s)...)
	}
	if got, want := len(fixtures), 40; got != want {
		t.Fatalf("cohort B fixture count: got %d, want %d", got, want)
	}
	runStressCohort(t, "B-EAD-bridge-distant-time", fixtures)
}

// ─────────────────────────────────────────────────────────────────
// COHORT C — same-hero back-to-back, different EAD.
//
// 10 pairs of matches, each pair 10 minutes apart (way past the 2-
// minute mergeWindow). Same map + same hero on both. DIFFERENT EAD
// per match — so the EAD-bridge has nothing to bridge against.
//
// Expected: both matches attribute to their own anchors. No bugs.
// This cohort proves baseline correctness for the most common
// "ladder grinding on the same map" case.
// ─────────────────────────────────────────────────────────────────

func TestCorrelation_Stress_SameHeroBackToBackClean(t *testing.T) {
	base := mustParseTS("Overwatch 2 Screenshot 2026.06.01 - 14.00.00")
	specs := make([]matchSpec, 0, 20)
	for i := 0; i < 10; i++ {
		x := base.Add(time.Duration(i*30) * time.Minute)
		y := x.Add(10 * time.Minute)
		mapName := pickAt(owMaps, i)
		hero := pickAt(owHeroes, i)

		specs = append(specs, matchSpec{
			startTime:    x,
			mapName:      mapName,
			mode:         "competitive",
			matchType:    pickAt(owMatchTypes, i),
			role:         pickAt(owRoles, i),
			primaryHero:  hero,
			eliminations: 12 + i, assists: 5 + i, deaths: 4 + i,
			damage: 5500, healing: 2200, mitigation: 1100,
			result:            "victory",
			date:              x.Format("01/02/2006"),
			finishedAt:        x.Add(45 * time.Second).Format("15:04"),
			emitSummary:       true,
			emitTeams:         true,
			useDefaultOffsets: true,
			suffix:            fmt.Sprintf("C%02dx", i),
			expectedKey:       matchKeyFor(x),
		})
		specs = append(specs, matchSpec{
			startTime:    y,
			mapName:      mapName,
			mode:         "competitive",
			matchType:    pickAt(owMatchTypes, i),
			role:         pickAt(owRoles, i),
			primaryHero:  hero,
			eliminations: 20 + i, assists: 10 + i, deaths: 6 + i, // DIFFERENT
			damage: 6500, healing: 2500, mitigation: 1200,
			result:            "defeat",
			date:              y.Format("01/02/2006"),
			finishedAt:        y.Add(45 * time.Second).Format("15:04"),
			emitSummary:       true,
			emitTeams:         true,
			useDefaultOffsets: true,
			suffix:            fmt.Sprintf("C%02dy", i),
			expectedKey:       matchKeyFor(y),
		})
	}

	fixtures := make([]fixture, 0, 40)
	for _, s := range specs {
		fixtures = append(fixtures, buildFixtures(s)...)
	}
	if got, want := len(fixtures), 40; got != want {
		t.Fatalf("cohort C fixture count: got %d, want %d", got, want)
	}
	runStressCohort(t, "C-same-hero-different-EAD", fixtures)
}

// ─────────────────────────────────────────────────────────────────
// COHORT D — same-hero back-to-back, identical EAD.
//
// 10 pairs of matches 10 minutes apart. Same hero + same map +
// IDENTICAL EAD. With PR #104's tight EAD-bridge windows, 10 min
// lands in the 5–30 min ambiguous zone — the resolver mints the
// "ambiguous-<filename>" sentinel and records X's match as the
// only candidate. Y's SUMMARY follows 30 s later, has no EAD of
// its own, and adopts Y's TEAMS sentinel via the
// timestamp-window pass. Both rows resolve together when the user
// picks an attribution in the Unknown tab.
// ─────────────────────────────────────────────────────────────────

func TestCorrelation_Stress_SameHeroIdenticalEAD(t *testing.T) {
	base := mustParseTS("Overwatch 2 Screenshot 2026.06.15 - 14.00.00")
	specs := make([]matchSpec, 0, 20)
	for i := 0; i < 10; i++ {
		x := base.Add(time.Duration(i*30) * time.Minute)
		y := x.Add(10 * time.Minute)
		mapName := pickAt(owMaps, i)
		hero := pickAt(owHeroes, i)
		e, a, d := 15+i, 9, 4

		// Y's TEAMS filename is what the ambiguous sentinel is
		// built from; both Y rows share that sentinel because the
		// SUMMARY adopts via timestamp window.
		yTeamsFilename := filenameForTS(y, fmt.Sprintf("D%02dyb", i), "teams")
		yAmbiguousKey := "ambiguous-" + yTeamsFilename

		specs = append(specs, matchSpec{
			startTime:    x,
			mapName:      mapName,
			mode:         "competitive",
			matchType:    pickAt(owMatchTypes, i),
			role:         pickAt(owRoles, i),
			primaryHero:  hero,
			eliminations: e, assists: a, deaths: d,
			damage: 5500, healing: 2200, mitigation: 1100,
			result:      "victory",
			date:        x.Format("01/02/2006"),
			finishedAt:  x.Add(45 * time.Second).Format("15:04"),
			emitSummary: true, emitTeams: true,
			useDefaultOffsets: true,
			suffix:            fmt.Sprintf("D%02dx", i),
			expectedKey:       matchKeyFor(x),
		})

		// Y emits TEAMS first (no date in MatchResult so the
		// rowsConflict predicate can't short-circuit the bridge).
		// Lands in the 5–30 min ambiguous zone → ambiguous sentinel.
		specs = append(specs, matchSpec{
			startTime:    y,
			mapName:      mapName,
			mode:         "competitive",
			primaryHero:  hero,
			eliminations: e, assists: a, deaths: d,
			damage: 5700, healing: 2300, mitigation: 1150,
			emitTeams:   true,
			teamsOffset: 0,
			suffix:      fmt.Sprintf("D%02dyb", i),
			expectedKey: yAmbiguousKey,
		})
		// Y SUMMARY 30s later — no EAD on summary side; adopts Y's
		// TEAMS sentinel via the timestamp-window pass.
		specs = append(specs, matchSpec{
			startTime:    y,
			mapName:      mapName,
			mode:         "competitive",
			primaryHero:  hero,
			eliminations: e, assists: a, deaths: d,
			result:        "defeat",
			date:          y.Format("01/02/2006"),
			finishedAt:    y.Add(45 * time.Second).Format("15:04"),
			emitSummary:   true,
			summaryOffset: 30 * time.Second,
			suffix:        fmt.Sprintf("D%02dys", i),
			expectedKey:   yAmbiguousKey,
			heroesPlayed: []parser.HeroPlay{
				{Hero: hero, PercentPlayed: 100, PlayTime: "12:34"},
			},
		})
	}

	fixtures := make([]fixture, 0, 40)
	for _, s := range specs {
		fixtures = append(fixtures, buildFixtures(s)...)
	}
	if got, want := len(fixtures), 40; got != want {
		t.Fatalf("cohort D fixture count: got %d, want %d", got, want)
	}
	runStressCohort(t, "D-same-hero-identical-EAD", fixtures)
}

// ─────────────────────────────────────────────────────────────────
// COHORT E — timestamp-window edges.
//
// 8 pairs of matches: two SUMMARY anchors 90 seconds apart with a
// PERSONAL captured exactly between them. No TEAMS screenshots — they'd
// pull PERSONAL toward whichever SUMMARY they neighbor and mask the
// genuine equidistance bug. PERSONAL is 45 s from each SUMMARY,
// hero matches both via the multi-hero set so neither side hard-
// conflicts.
//
// PR #106 surfaces this as ambiguous via the new tieToleranceWindow
// path in matchByTimestampWindow: two distinct match_keys tied
// within 5 s of each other → mint "ambiguous-<filename>" + a
// candidate list. The user resolves via the Unknown tab's
// "Needs your review" subsection (same UI PR #104 introduced for
// EAD-bridge ambiguity).
// ─────────────────────────────────────────────────────────────────

func TestCorrelation_Stress_TimestampWindowEdge(t *testing.T) {
	base := mustParseTS("Overwatch 2 Screenshot 2026.07.01 - 14.00.00")
	specs := make([]matchSpec, 0, 24)
	for i := 0; i < 8; i++ {
		x := base.Add(time.Duration(i*30) * time.Minute)
		y := x.Add(90 * time.Second) // tight window
		midPersonal := x.Add(45 * time.Second)

		mapNameX := pickAt(owMaps, i)
		mapNameY := pickAt(owMaps, i+5) // different so EAD bridge can't fire on map
		heroX := pickAt(owHeroes, i)
		heroY := heroX // SAME hero so PERSONAL doesn't hit hero conflict

		// PERSONAL's filename is what the ambiguous sentinel embeds.
		personalFilename := filenameForTS(midPersonal, fmt.Sprintf("E%02dp", i), "personal")
		ambiguousKey := "ambiguous-" + personalFilename

		specs = append(specs, matchSpec{
			startTime:   x,
			mapName:     mapNameX,
			mode:        "competitive",
			primaryHero: heroX,
			result:      "victory",
			date:        x.Format("01/02/2006"),
			finishedAt:  x.Format("15:04"),
			emitSummary: true,
			suffix:      fmt.Sprintf("E%02dx", i),
			expectedKey: matchKeyFor(x),
		})

		specs = append(specs, matchSpec{
			startTime:   y,
			mapName:     mapNameY,
			mode:        "competitive",
			primaryHero: heroY,
			result:      "victory",
			date:        y.Format("01/02/2006"),
			finishedAt:  y.Format("15:04"),
			emitSummary: true,
			suffix:      fmt.Sprintf("E%02dy", i),
			expectedKey: matchKeyFor(y),
		})

		// PERSONAL midway — tied 45 s from each SUMMARY, both within
		// the 5 s tieToleranceWindow → ambiguous sentinel.
		specs = append(specs, matchSpec{
			startTime:      midPersonal,
			primaryHero:    heroX,
			emitPersonal:   true,
			personalOffset: 0,
			suffix:         fmt.Sprintf("E%02dp", i),
			expectedKey:    ambiguousKey,
		})
	}

	fixtures := make([]fixture, 0, 24)
	for _, s := range specs {
		fixtures = append(fixtures, buildFixtures(s)...)
	}
	// 8 pairs × (X:1 + Y:1 + P:1) = 24.
	if got, want := len(fixtures), 24; got != want {
		t.Fatalf("cohort E fixture count: got %d, want %d", got, want)
	}
	runStressCohort(t, "E-timestamp-window-edge", fixtures)
}

// ─────────────────────────────────────────────────────────────────
// COHORT F — multi-hero match (TEAMS mid-game hero swap).
//
// 10 matches. Each match's SUMMARY records hero=Hero1 (the most-
// played one, e.g. Lúcio 70%). TEAMS + PERSONAL were captured
// during the Kiriko portion (the secondary hero).
//
// Before PR #105, rowsConflict() refused to bridge a TEAMS
// with hero=Kiriko to a SUMMARY with hero=Lúcio — ONE logical match
// became THREE match_keys. PR #105 weakens the hero predicate to
// consult the per-match hero set (SUMMARY's HeroesPlayed union)
// so the swap hero is recognized and the rows fold together.
//
// Per match: 4 fixtures (SUMMARY + TEAMS + PERSONAL + RANK).
// All four now adopt SUMMARY's anchor cleanly.
// ─────────────────────────────────────────────────────────────────

func TestCorrelation_Stress_MultiHeroTeamsSwap(t *testing.T) {
	base := mustParseTS("Overwatch 2 Screenshot 2026.07.15 - 14.00.00")
	specs := make([]matchSpec, 0, 10)
	for i := 0; i < 10; i++ {
		start := base.Add(time.Duration(i*15) * time.Minute)
		primary := "lucio"
		swap := "kiriko"
		if i%2 == 1 {
			primary, swap = "mercy", "ana"
		}

		// SUMMARY adopts a fresh key.
		specs = append(specs, matchSpec{
			startTime:   start,
			mapName:     pickAt(owMaps, i),
			mode:        "competitive",
			primaryHero: primary,
			heroesPlayed: []parser.HeroPlay{
				{Hero: primary, PercentPlayed: 70, PlayTime: "08:30"},
				{Hero: swap, PercentPlayed: 30, PlayTime: "04:04"},
			},
			eliminations: 18, assists: 12, deaths: 6,
			damage: 5800, healing: 3200, mitigation: 800,
			result:     "victory",
			date:       start.Format("01/02/2006"),
			finishedAt: start.Format("15:04"),
			teamsHero:  swap, personalHero: swap,
			emitSummary: true,
			suffix:      fmt.Sprintf("F%02ds", i),
			expectedKey: matchKeyFor(start),
		})

		// TEAMS is combat-stats only (no hero) — it adopts the SUMMARY's
		// key via its unique E/A/D bridging to the same match + the
		// timestamp window. Per-match EADs differ (real matches do), so
		// the teams resolves without needing a disambiguating hero.
		sbStart := start.Add(30 * time.Second)
		specs = append(specs, matchSpec{
			startTime:    sbStart,
			mapName:      pickAt(owMaps, i),
			mode:         "competitive",
			primaryHero:  swap,
			eliminations: 18 + i, assists: 12, deaths: 6,
			damage: 5800, healing: 3200, mitigation: 800,
			emitTeams:   true,
			teamsOffset: 0,
			suffix:      fmt.Sprintf("F%02db", i),
			expectedKey: matchKeyFor(start),
		})

		// PERSONAL of swap hero — adopts the same SUMMARY anchor
		// for the same reason; TEAMS hero is in the match's
		// hero set so the rowsConflict short-circuit allows the
		// timestamp-window bridge to the existing key.
		pStart := start.Add(45 * time.Second)
		specs = append(specs, matchSpec{
			startTime:      pStart,
			primaryHero:    swap,
			emitPersonal:   true,
			personalOffset: 0,
			suffix:         fmt.Sprintf("F%02dp", i),
			expectedKey:    matchKeyFor(start),
		})

		// RANK has no hero field; adopts via timestamp window without
		// needing the hero set. Now points back at SUMMARY since the
		// TEAMS/PERSONAL chain it used to follow is collapsed
		// into the same match_key.
		rStart := start.Add(90 * time.Second)
		specs = append(specs, matchSpec{
			startTime: rStart, emitRank: true, rankOffset: 0,
			rankBand: "diamond", rankLevel: 3, rankProgress: 60, rankChange: 24, rankResult: "victory",
			suffix:      fmt.Sprintf("F%02dr", i),
			expectedKey: matchKeyFor(start),
		})
	}

	fixtures := make([]fixture, 0, 40)
	for _, s := range specs {
		fixtures = append(fixtures, buildFixtures(s)...)
	}
	if got, want := len(fixtures), 40; got != want {
		t.Fatalf("cohort F fixture count: got %d, want %d", got, want)
	}
	runStressCohort(t, "F-multi-hero-teams-swap", fixtures)
}

// ─────────────────────────────────────────────────────────────────
// COHORT G — multi-hero match (2 PERSONAL screenshots, different hero each).
//
// 5 matches. SUMMARY hero=A. Player opened PERSONAL on Hero A early
// then PERSONAL on Hero B later in the same match. Same multi-hero
// fix as cohort F: PR #105's hero-set check recognizes hero B as
// belonging to the match (SUMMARY.HeroesPlayed includes it) and the
// second PERSONAL adopts the existing match_key.
// ─────────────────────────────────────────────────────────────────

func TestCorrelation_Stress_MultiHeroTwoPersonals(t *testing.T) {
	base := mustParseTS("Overwatch 2 Screenshot 2026.07.20 - 14.00.00")
	specs := make([]matchSpec, 0, 5)
	for i := 0; i < 5; i++ {
		start := base.Add(time.Duration(i*20) * time.Minute)
		heroA := pickAt(owHeroes, i*2)
		heroB := pickAt(owHeroes, i*2+1)

		// SUMMARY anchors the match on heroA.
		specs = append(specs, matchSpec{
			startTime:   start,
			mapName:     pickAt(owMaps, i),
			mode:        "competitive",
			primaryHero: heroA,
			heroesPlayed: []parser.HeroPlay{
				{Hero: heroA, PercentPlayed: 60, PlayTime: "07:30"},
				{Hero: heroB, PercentPlayed: 40, PlayTime: "05:00"},
			},
			eliminations: 15, assists: 8, deaths: 5,
			damage: 5000, healing: 2200, mitigation: 800,
			result:      "victory",
			date:        start.Format("01/02/2006"),
			finishedAt:  start.Format("15:04"),
			emitSummary: true,
			suffix:      fmt.Sprintf("G%02ds", i),
			expectedKey: matchKeyFor(start),
		})

		// TEAMS (combat-stats only) adopts via its unique E/A/D + the
		// timestamp window — per-match EADs differ so no hero is needed.
		sbStart := start.Add(30 * time.Second)
		specs = append(specs, matchSpec{
			startTime:    sbStart,
			mapName:      pickAt(owMaps, i),
			mode:         "competitive",
			primaryHero:  heroA,
			eliminations: 15 + i, assists: 8, deaths: 5,
			damage: 5000, healing: 2200, mitigation: 800,
			emitTeams:   true,
			teamsOffset: 0,
			suffix:      fmt.Sprintf("G%02db", i),
			expectedKey: matchKeyFor(start),
		})

		// PERSONAL 1 (heroA) adopts cleanly via timestamp window.
		p1Start := start.Add(45 * time.Second)
		specs = append(specs, matchSpec{
			startTime:      p1Start,
			primaryHero:    heroA,
			emitPersonal:   true,
			personalOffset: 0,
			suffix:         fmt.Sprintf("G%02dp1", i),
			expectedKey:    matchKeyFor(start),
		})

		// PERSONAL 2 (heroB) adopts via timestamp window — heroB is
		// in SUMMARY.HeroesPlayed, so the per-match hero set lets
		// rowsConflict allow the bridge despite the local
		// heroB↔heroA mismatch on PERSONAL 1.
		p2Start := start.Add(75 * time.Second)
		specs = append(specs, matchSpec{
			startTime:      p2Start,
			primaryHero:    heroB,
			emitPersonal:   true,
			personalOffset: 0,
			suffix:         fmt.Sprintf("G%02dp2", i),
			expectedKey:    matchKeyFor(start),
		})
	}

	fixtures := make([]fixture, 0, 20)
	for _, s := range specs {
		fixtures = append(fixtures, buildFixtures(s)...)
	}
	if got, want := len(fixtures), 20; got != want {
		t.Fatalf("cohort G fixture count: got %d, want %d", got, want)
	}
	runStressCohort(t, "G-multi-hero-two-personals", fixtures)
}

// ─────────────────────────────────────────────────────────────────
// COHORT H — RANK adoption (clean).
//
// 10 matches with SUMMARY + TEAMS + RANK. No PERSONAL. RANK's
// MatchResult has no map, no hero (the resolver materializes it
// from rank_screenshots with Rank + Result + Level only). Adopts
// via timestamp window only.
// ─────────────────────────────────────────────────────────────────

func TestCorrelation_Stress_RankAdoption(t *testing.T) {
	base := mustParseTS("Overwatch 2 Screenshot 2026.08.01 - 14.00.00")
	specs := make([]matchSpec, 0, 10)
	for i := 0; i < 10; i++ {
		start := base.Add(time.Duration(i*15) * time.Minute)
		specs = append(specs, matchSpec{
			startTime:    start,
			mapName:      pickAt(owMaps, i),
			mode:         "competitive",
			primaryHero:  pickAt(owHeroes, i),
			eliminations: 10 + i, assists: 5 + i, deaths: 3 + i,
			damage: 5000, healing: 2000, mitigation: 1000,
			result:            "victory",
			date:              start.Format("01/02/2006"),
			finishedAt:        start.Format("15:04"),
			rankBand:          pickAt([]string{"bronze", "silver", "gold", "platinum", "diamond", "master", "grandmaster"}, i),
			rankLevel:         1 + (i % 5),
			rankProgress:      20 + i*7,
			rankChange:        12 + i,
			rankResult:        "victory",
			emitSummary:       true,
			emitTeams:         true,
			emitRank:          true,
			useDefaultOffsets: true,
			suffix:            fmt.Sprintf("H%02d", i),
			expectedKey:       matchKeyFor(start),
		})
	}

	fixtures := make([]fixture, 0, 30)
	for _, s := range specs {
		fixtures = append(fixtures, buildFixtures(s)...)
	}
	if got, want := len(fixtures), 30; got != want {
		t.Fatalf("cohort H fixture count: got %d, want %d", got, want)
	}
	runStressCohort(t, "H-rank-adoption", fixtures)
}

// ─────────────────────────────────────────────────────────────────
// COHORT I — zero-stat teams.
//
// 5 matches with EAD = (0, 0, 0) on TEAMS — modeling games
// that ended in the first minute (rage-quit, server crash). EAD-
// bridge can't fire (it short-circuits on zero stats), so adoption
// is timestamp-window only. SUMMARY usually arrives with non-zero
// `Result + Date + FinishedAt + GameLength` even when stats are
// zero, so the SUMMARY itself mints the anchor and TEAMS
// adopts via the window.
// ─────────────────────────────────────────────────────────────────

func TestCorrelation_Stress_ZeroStatTeams(t *testing.T) {
	base := mustParseTS("Overwatch 2 Screenshot 2026.08.10 - 14.00.00")
	specs := make([]matchSpec, 0, 5)
	for i := 0; i < 5; i++ {
		start := base.Add(time.Duration(i*15) * time.Minute)
		specs = append(specs, matchSpec{
			startTime:    start,
			mapName:      pickAt(owMaps, i),
			mode:         "competitive",
			primaryHero:  pickAt(owHeroes, i),
			eliminations: 0, assists: 0, deaths: 0,
			damage: 0, healing: 0, mitigation: 0,
			result:            "draw",
			date:              start.Format("01/02/2006"),
			finishedAt:        start.Format("15:04"),
			gameLength:        "00:42",
			emitSummary:       true,
			emitTeams:         true,
			emitPersonal:      true,
			emitRank:          true,
			useDefaultOffsets: true,
			suffix:            fmt.Sprintf("I%02d", i),
			expectedKey:       matchKeyFor(start),
		})
	}

	fixtures := make([]fixture, 0, 20)
	for _, s := range specs {
		fixtures = append(fixtures, buildFixtures(s)...)
	}
	if got, want := len(fixtures), 20; got != want {
		t.Fatalf("cohort I fixture count: got %d, want %d", got, want)
	}
	runStressCohort(t, "I-zero-stat-teams", fixtures)
}

// ─────────────────────────────────────────────────────────────────
// COHORT J — unparseable filename timestamps.
//
// 15 PERSONAL screenshots with filenames that don't carry the
// `YYYY.MM.DD - HH.MM.SS` portion (user renamed them, dragged from
// an old session, or saved from a screenshot tool that uses a
// different naming scheme). resolveMatchKey's fresh-key fallback
// mints `unmatched:<filename>` for each.
// ─────────────────────────────────────────────────────────────────

func TestCorrelation_Stress_UnparseableFilenames(t *testing.T) {
	fixtures := make([]fixture, 0, 15)
	manualNames := []string{
		"screenshot-1.png", "screenshot-2.png", "screenshot-3.png",
		"my-clutch-game.png", "final-rank-up.png", "rialto-juno.png",
		"final.png", "summary.png", "teams.png",
		"backup_20260801.png", "old_overwatch.png", "saved-3.png",
		"untitled.png", "img_0042.png", "captures_0017.png",
	}
	for i, name := range manualNames {
		hero := pickAt(owHeroes, i)
		fixtures = append(fixtures, fixture{
			filename:    name,
			scrType:     "personal",
			result:      &parser.MatchResult{Hero: hero},
			expectedKey: "unmatched-" + name,
		})
	}
	if got, want := len(fixtures), 15; got != want {
		t.Fatalf("cohort J fixture count: got %d, want %d", got, want)
	}
	runStressCohort(t, "J-unparseable-filenames", fixtures)
}

// ─────────────────────────────────────────────────────────────────
// COHORT K — identical filename timestamps (duplicates).
//
// 5 triples (3 screenshots each at the SAME filename timestamp).
// Models the "user dragged the same folder into the watch dir
// twice" scenario, or two captures within the same second from a
// fast tab-cycler. In production the DB's UNIQUE(filename)
// constraint would reject one as a duplicate, but the resolver
// pre-DB doesn't know about that — it just sees three rows with
// the same parsed timestamp and runs its matcher.
//
// Each triple uses a different `suffix` to keep filenames distinct
// (so the cohort actually tests the matcher rather than the DB
// constraint). The triples are SUMMARY + TEAMS + PERSONAL —
// all of which should attribute to the same match.
// ─────────────────────────────────────────────────────────────────

func TestCorrelation_Stress_IdenticalTimestamps(t *testing.T) {
	base := mustParseTS("Overwatch 2 Screenshot 2026.08.20 - 14.00.00")
	specs := make([]matchSpec, 0, 5)
	for i := 0; i < 5; i++ {
		start := base.Add(time.Duration(i*15) * time.Minute)
		specs = append(specs, matchSpec{
			startTime:    start,
			mapName:      pickAt(owMaps, i),
			mode:         "competitive",
			primaryHero:  pickAt(owHeroes, i),
			eliminations: 10 + i, assists: 5 + i, deaths: 4 + i,
			result:         "victory",
			date:           start.Format("01/02/2006"),
			finishedAt:     start.Format("15:04"),
			emitSummary:    true,
			emitTeams:      true,
			emitPersonal:   true,
			summaryOffset:  0,
			teamsOffset:    0, // identical to SUMMARY
			personalOffset: 0, // identical to SUMMARY
			suffix:         fmt.Sprintf("K%02d", i),
			expectedKey:    matchKeyFor(start),
		})
	}

	fixtures := make([]fixture, 0, 15)
	for _, s := range specs {
		fixtures = append(fixtures, buildFixtures(s)...)
	}
	if got, want := len(fixtures), 15; got != want {
		t.Fatalf("cohort K fixture count: got %d, want %d", got, want)
	}
	runStressCohort(t, "K-identical-timestamps", fixtures)
}
