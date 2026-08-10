package fixtures

import "math/rand"

// Test-only bridges for the external fixtures_test package: the role/weight
// helpers and chaos data tables are pure internals of the generator with no
// public entry point. Relocated here from the former pkg/app bridge when this
// package was carved out. Compiled only under test.
var (
	RoleOfHero       = roleOfHero
	FixtureDateRange = fixtureDateRange
	ChaosEmojis      = chaosEmojis

	// FixtureNow is a pointer seam so tests can swap the deterministic clock.
	FixtureNow = &fixtureNow
)

// The hero/map pools are REASSIGNED in this package's init() (derived from the
// parser's YAML), and test-file package vars initialize before init() runs — a
// `var FixtureTanks = fixtureTanks` shim freezes the pre-init nil header and
// silently empties every assertion that ranges over it. Functions read the
// live values.
func FixtureDPS() []string      { return fixtureDPS }
func FixtureMaps() []string     { return fixtureMaps }
func FixtureSupports() []string { return fixtureSupports }
func FixtureTanks() []string    { return fixtureTanks }

// ── Rank-climb model bridges ──────────────────────────────────────────────
// The ladder walk (advance/meterBand/winProb/…), the true-skill line, and the
// per-day human state are pure internals of the seed generator with no public
// entry point; the rank/story tests pin their math and the shipped tour
// realization through these bridges. Compiled only under test.

// Aliases so the external package can name values of the unexported types.
type (
	LadderPos   = ladderPos
	RankCard    = rankCard
	PlayerState = playerState
)

var (
	TierNames       = tierNames
	TrackSkillLines = trackSkillLines

	Advance       = advance
	MeterBand     = meterBand
	WinProb       = winProb
	TrueSkillAt   = trueSkillAt
	PerMatchDelta = perMatchDelta
	PickModifier  = pickModifier
	RankTrackKey  = rankTrackKey
	NewTrackWalks = newTrackWalks
	SRFromLadder  = srFromLadder
	LadderScore   = ladderScore
	DaysBetween   = daysBetween
)

const (
	WrEqualize        = wrEqualize
	WrGapCap          = wrGapCap
	WrCeiling         = wrCeiling
	FormAmpPts        = formAmpPts
	CalibrationGames  = calibrationGames
	StreakThreshold   = streakThreshold
	MeaningfulHeroPct = meaningfulHeroPct
	RustGapDays       = rustGapDays
	TiltRunStart      = tiltRunStart
	RustMaxPts        = rustMaxPts
)

// NewLadderPos builds a ladder position (unexported fields) for the external
// tests' literals and comparisons.
func NewLadderPos(tier, div, prog int) ladderPos {
	return ladderPos{tier: tier, div: div, prog: prog}
}

// Tier / Div / Prog read the ladder-position fields.
func (p ladderPos) Tier() int { return p.tier }
func (p ladderPos) Div() int  { return p.div }
func (p ladderPos) Prog() int { return p.prog }

// Start / End read a skill line's season endpoints.
func (l skillLine) Start() float64 { return l.start }
func (l skillLine) End() float64   { return l.end }

// NewTrackWalk builds a walk mid-season (unexported fields) so a test can
// start from an arbitrary position with the cadence counters zeroed.
func NewTrackWalk(pos ladderPos, grace bool, games, lastSR int) *trackWalk {
	return &trackWalk{pos: pos, grace: grace, games: games, lastSR: lastSR}
}

// Step advances the walk by one game; Pos / Grace read its climbing state.
func (w *trackWalk) Step(rng *rand.Rand, result string) *rankCard { return w.step(rng, result) }
func (w *trackWalk) Pos() ladderPos                               { return w.pos }
func (w *trackWalk) Grace() bool                                  { return w.grace }

// Pos / ChangePercent read the emitted rank card.
func (c rankCard) Pos() ladderPos     { return c.pos }
func (c rankCard) ChangePercent() int { return c.changePercent }

// Observe / Record drive the per-day human state; LastDay / DayLossRun read it.
func (ps *playerState) Observe(day string) float64 { return ps.observe(day) }
func (ps *playerState) Record(result string)       { ps.record(result) }
func (ps *playerState) LastDay() string            { return ps.lastDay }
func (ps *playerState) DayLossRun() int            { return ps.dayLossRun }

// Chaos-shape registry surface — the completeness test pins that every
// category has a registered mutation (a map dispatch loses the
// `exhaustive` switch check).
var (
	AllChaosCategories = allChaosCategories
	ChaosShapes        = chaosShapes
)

// ── Hero-pick bridges ─────────────────────────────────────────────────────
// The style-aware pick helpers are pure internals of the generator; the
// role tests pin the constrained-favorites derivation through these.

var (
	NewProfileForStyle = newPlayerProfile
	ParsePlayStyle     = parsePlayStyle
)

// ConstrainedFavorites / FavoriteHero / MainRole / MainPool / FlexHeroes
// read the pick-profile state the constrained-role tests assert on.
func (p playerProfile) ConstrainedFavorites(role string) []string {
	return p.constrainedFavorites(role)
}
func (p playerProfile) FavoriteHero() string { return p.favoriteHero }
func (p playerProfile) MainRole() string     { return p.mainRole }
func (p playerProfile) MainPool() []string   { return p.mainPool }
func (p playerProfile) FlexHeroes() []string { return p.flexHeroes }
