package fixtures

// Test-only bridges for the external fixtures_test package: the role/weight
// helpers and chaos data tables are pure internals of the generator with no
// public entry point. Relocated here from the former pkg/app bridge when this
// package was carved out. Compiled only under test.
var (
	RoleOfHero       = roleOfHero
	FixtureDateRange = fixtureDateRange
	ChaosEmojis      = chaosEmojis
	FixtureDPS       = fixtureDPS
	FixtureMaps      = fixtureMaps
	FixtureSupports  = fixtureSupports
	FixtureTanks     = fixtureTanks

	// FixtureNow is a pointer seam so tests can swap the deterministic clock.
	FixtureNow = &fixtureNow
)
