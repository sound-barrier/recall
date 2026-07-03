package gamedata

// Test-only bridges for the external gamedata_test package. The HTTP
// hardening helpers and YAML roster parsers have no public entry
// point; compiled only under test, so they widen no API.

var (
	UpdateAllowedHost = updateAllowedHost
	VerifySha256      = verifySha256
	ParseRosterNames  = parseRosterNames
)
