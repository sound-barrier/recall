package app

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"recall/pkg/db"
	"recall/pkg/parser"
)

// Test-only helpers for the 400-screenshot correlation stress dataset.
//
// Each cohort in correlation_stress_test.go declares a slice of
// `matchSpec` describing one logical match — its start time, map,
// hero(es), stats, and which screenshot types to emit. The builder
// expands one spec into per-type `fixture` records (Filename + a
// minimal MatchResult + an expected match_key the resolver should
// settle on).
//
// `runStressCohort` walks the fixtures in order:
//
//   1. Calls `resolveMatchKey` against the current snapshot state.
//   2. Compares the resolved key with the fixture's `expectedKey`. A
//      mismatch fails the test; a match is logged at v=2.
//   3. Inserts the fixture into the snapshot under the EXPECTED key
//      so subsequent fixtures see the world the way the resolver
//      under test believes it to be — even when the expected key is
//      a bug (`bugNote != ""`). Pinning the buggy behavior is the
//      whole point: a future PR that fixes the resolver MUST update
//      the expected key, which makes the test the gate on every
//      regression in either direction.
//
// `bugNote` carries the human-readable reason an expectation is
// known wrong. The harness prints it via `t.Logf` so the run output
// doubles as a bug inventory. Counts roll up in `t.Cleanup` so the
// top of the file reads "Stress dataset: 400 fixtures, X bug
// expectations pinned." without grepping logs.

// matchSpec describes one logical Overwatch match. The builder
// expands it into N fixtures (one per emit* flag set true) sharing
// the same expected match_key.
type matchSpec struct {
	// startTime anchors the SUMMARY screenshot's filename timestamp.
	// Other screenshots offset from this — see the *Offset fields.
	startTime time.Time

	// Match-level fields used by every emitted screenshot type.
	// `primaryHero` is the SUMMARY's `hero` (i.e. the most-played
	// hero in the match's heroes_played array). Mid-match swap is
	// modeled via `scoreboardHero` / `personalHero` overrides.
	mapName      string
	mode         string
	matchType    string
	role         string
	primaryHero  string
	heroesPlayed []parser.HeroPlay

	eliminations int
	assists      int
	deaths       int
	damage       int
	healing      int
	mitigation   int

	result     string
	finalScore string
	date       string
	finishedAt string
	gameLength string

	// scoreboardHero, personalHero, personal2Hero override the hero on
	// the relevant screenshot. Empty string = inherit primaryHero.
	// emitPersonal2 turns on a SECOND PERSONAL screenshot at
	// personal2Offset for mid-match swap modeling (cohort G).
	scoreboardHero string
	personalHero   string
	personal2Hero  string

	rankBand     string // "diamond", "master", etc.
	rankLevel    int
	rankProgress int
	rankChange   int
	rankResult   string

	// Which screenshot types to emit for this spec. Default builder
	// turns all four on; cohorts that want a subset zero out the
	// flags they don't want.
	emitSummary    bool
	emitScoreboard bool
	emitPersonal   bool
	emitPersonal2  bool
	emitRank       bool

	// Offsets from startTime for each emitted screenshot's filename
	// timestamp. Zero offsets land at startTime exactly. Standard
	// builder defaults are summary=+0, scoreboard=+30s, personal=+45s,
	// personal2=+75s, rank=+90s.
	summaryOffset    time.Duration
	scoreboardOffset time.Duration
	personalOffset   time.Duration
	personal2Offset  time.Duration
	rankOffset       time.Duration

	// Filename label tucked into the screenshot filename so an
	// otherwise-identical pair of matches still has distinct
	// filenames (the DB schema's UNIQUE(filename) demands it).
	// Cohorts that ship multiple specs with the same startTime set
	// this so duplicates don't collide.
	suffix string

	// expectedKey is the key every fixture from this spec should
	// resolve to. Cohorts that document bugs set this to the WRONG
	// key the current resolver returns + leave `bugNote` non-empty
	// so the harness logs the discrepancy.
	expectedKey string
	bugNote     string

	// useDefaultOffsets fills the *Offset fields with the
	// conventional cluster (SUMMARY=+0, SCOREBOARD=+30s,
	// PERSONAL=+45s, PERSONAL2=+75s, RANK=+90s) when true. Cohorts
	// that emit one screenshot per spec leave this false so each
	// screenshot's filename timestamp lands exactly at startTime.
	useDefaultOffsets bool
}

// fixture is one screenshot the resolver will see.
type fixture struct {
	filename    string
	scrType     string // "summary" | "scoreboard" | "personal" | "rank"
	result      *parser.MatchResult
	expectedKey string
	bugNote     string
}

// buildFixtures expands one matchSpec into the per-type fixtures the
// resolver should see. Order in the returned slice — SUMMARY,
// SCOREBOARD, PERSONAL, PERSONAL2, RANK — is the canonical emission
// order; cohorts that want a different order build separate specs.
//
// Offsets are honoured exactly. `defaultOffsets()` returns a
// matchSpec preset with the conventional offsets (SUMMARY=+0,
// SCOREBOARD=+30s, PERSONAL=+45s, PERSONAL2=+75s, RANK=+90s);
// cohorts compose it with `spec.startTime = …` etc. Cohorts that
// model the "one screenshot at this exact instant" case (e.g.
// COHORT E's lone PERSONAL between two SUMMARY anchors) pass a
// spec where `startTime` IS the screenshot's filename timestamp
// and leave the offset at zero.
func buildFixtures(spec matchSpec) []fixture {
	if spec.useDefaultOffsets {
		spec.summaryOffset = 0
		spec.scoreboardOffset = 30 * time.Second
		spec.personalOffset = 45 * time.Second
		spec.personal2Offset = 75 * time.Second
		spec.rankOffset = 90 * time.Second
	}
	out := make([]fixture, 0, 5)
	if spec.emitSummary {
		out = append(out, fixture{
			filename: filenameForTS(spec.startTime.Add(spec.summaryOffset), spec.suffix, "summary"),
			scrType:  "summary",
			result: &parser.MatchResult{
				Map:          spec.mapName,
				Mode:         spec.mode,
				Type:         spec.matchType,
				Role:         spec.role,
				Hero:         spec.primaryHero,
				HeroesPlayed: spec.heroesPlayed,
				Result:       spec.result,
				FinalScore:   spec.finalScore,
				Date:         spec.date,
				FinishedAt:   spec.finishedAt,
				GameLength:   spec.gameLength,
			},
			expectedKey: spec.expectedKey,
			bugNote:     spec.bugNote,
		})
	}
	if spec.emitScoreboard {
		hero := spec.primaryHero
		if spec.scoreboardHero != "" {
			hero = spec.scoreboardHero
		}
		out = append(out, fixture{
			filename: filenameForTS(spec.startTime.Add(spec.scoreboardOffset), spec.suffix, "scoreboard"),
			scrType:  "scoreboard",
			result: &parser.MatchResult{
				Map:          spec.mapName,
				Mode:         spec.mode,
				Type:         spec.matchType,
				Role:         spec.role,
				Hero:         hero,
				Eliminations: spec.eliminations,
				Assists:      spec.assists,
				Deaths:       spec.deaths,
				Damage:       spec.damage,
				Healing:      spec.healing,
				Mitigation:   spec.mitigation,
			},
			expectedKey: spec.expectedKey,
			bugNote:     spec.bugNote,
		})
	}
	if spec.emitPersonal {
		hero := spec.primaryHero
		if spec.personalHero != "" {
			hero = spec.personalHero
		}
		out = append(out, fixture{
			filename: filenameForTS(spec.startTime.Add(spec.personalOffset), spec.suffix, "personal"),
			scrType:  "personal",
			result: &parser.MatchResult{
				Hero: hero,
			},
			expectedKey: spec.expectedKey,
			bugNote:     spec.bugNote,
		})
	}
	if spec.emitPersonal2 {
		hero := spec.personal2Hero
		if hero == "" {
			hero = spec.primaryHero
		}
		out = append(out, fixture{
			filename: filenameForTS(spec.startTime.Add(spec.personal2Offset), spec.suffix+"b", "personal"),
			scrType:  "personal",
			result: &parser.MatchResult{
				Hero: hero,
			},
			expectedKey: spec.expectedKey,
			bugNote:     spec.bugNote,
		})
	}
	if spec.emitRank {
		out = append(out, fixture{
			filename: filenameForTS(spec.startTime.Add(spec.rankOffset), spec.suffix, "rank"),
			scrType:  "rank",
			result: &parser.MatchResult{
				Rank:          spec.rankBand,
				Level:         spec.rankLevel,
				RankProgress:  spec.rankProgress,
				ChangePercent: spec.rankChange,
				Result:        spec.rankResult,
			},
			expectedKey: spec.expectedKey,
			bugNote:     spec.bugNote,
		})
	}
	return out
}

// filenameForTS renders the timestamp into the OW client's filename
// format ("Overwatch 2 Screenshot YYYY.MM.DD - HH.MM.SS.NN.png") and
// appends an optional suffix so two screenshots at the same instant
// don't collide on the DB's UNIQUE(filename) constraint.
func filenameForTS(ts time.Time, suffix, kind string) string {
	base := fmt.Sprintf("Overwatch 2 Screenshot %s.00", ts.Format("2006.01.02 - 15.04.05"))
	parts := []string{base}
	if suffix != "" {
		parts = append(parts, suffix)
	}
	parts = append(parts, kind)
	return strings.Join(parts, "_") + ".png"
}

// mustParseTS panics if the timestamp string can't be parsed. Used
// in test data declarations where a parse failure would be the
// author's typo, not a runtime condition.
func mustParseTS(s string) time.Time {
	t, err := time.Parse("2006.01.02 - 15.04.05", s)
	if err != nil {
		panic(fmt.Sprintf("mustParseTS(%q): %v", s, err))
	}
	return t
}

// matchKeyFor formats `match:<ISO>` the same way resolveMatchKey
// does for the fresh-key path. Cohorts use this for their expected
// keys so a clock-skew change in the resolver shows up as a test
// failure on every cohort at once.
func matchKeyFor(ts time.Time) string {
	return "match:" + ts.UTC().Format("2006-01-02T15:04:05")
}

// snapshotState wraps db.Screenshots with Insert helpers. It mirrors
// the parent-table UPSERT path: each screenshot lands in the right
// slice with the right MatchKey, so the next call to
// `resolveMatchKey` sees the same shape it would see in production.
type snapshotState struct {
	snap db.Screenshots
}

func (s *snapshotState) Insert(f fixture) {
	switch f.scrType {
	case "summary":
		r := f.result
		s.snap.Summaries = append(s.snap.Summaries, db.SummaryRow{
			Filename: f.filename, MatchKey: f.expectedKey,
			Map: r.Map, Mode: r.Mode, Hero: r.Hero,
			Result: r.Result, FinalScore: r.FinalScore,
			Date: r.Date, FinishedAt: r.FinishedAt, GameLength: r.GameLength,
		})
	case "scoreboard":
		r := f.result
		s.snap.Scoreboards = append(s.snap.Scoreboards, db.ScoreboardRow{
			Filename: f.filename, MatchKey: f.expectedKey,
			Map: r.Map, Mode: r.Mode, Hero: r.Hero,
			Eliminations: r.Eliminations, Assists: r.Assists, Deaths: r.Deaths,
			Damage: r.Damage, Healing: r.Healing, Mitigation: r.Mitigation,
		})
	case "personal":
		s.snap.Personals = append(s.snap.Personals, db.PersonalRow{
			Filename: f.filename, MatchKey: f.expectedKey,
			Hero: f.result.Hero,
		})
	case "rank":
		s.snap.Ranks = append(s.snap.Ranks, db.RankRow{
			Filename: f.filename, MatchKey: f.expectedKey,
			Rank: f.result.Rank, Level: f.result.Level,
			RankProgress: f.result.RankProgress, ChangePercent: f.result.ChangePercent,
			Result: f.result.Result,
		})
	default:
		panic("snapshotState.Insert: unknown scrType " + f.scrType)
	}
}

// runStressCohort feeds fixtures through resolveMatchKey one at a
// time, asserts each result against fixture.expectedKey, logs any
// pinned-bug expectations, and inserts each into snap so the next
// fixture sees the prior world. Order of fixtures matters — caller
// is responsible for ordering them the way the production stream
// would arrive (filename timestamps ascending unless the cohort
// specifically tests out-of-order arrival).
func runStressCohort(t *testing.T, name string, fixtures []fixture) {
	t.Helper()
	if len(fixtures) == 0 {
		t.Fatalf("[%s] empty cohort", name)
	}
	s := &snapshotState{}
	bugCount := 0
	for _, f := range fixtures {
		got, _ := resolveMatchKey(f.filename, f.result, s.snap)
		if got != f.expectedKey {
			t.Errorf("[%s] %s (%s): got %q, want %q",
				name, f.filename, f.scrType, got, f.expectedKey)
			continue
		}
		if f.bugNote != "" {
			bugCount++
			t.Logf("[%s] BUG-PIN %s (%s) → %q: %s",
				name, f.filename, f.scrType, f.expectedKey, f.bugNote)
		}
		s.Insert(f)
	}
	t.Logf("[%s] %d fixtures, %d buggy expectations pinned",
		name, len(fixtures), bugCount)
}
