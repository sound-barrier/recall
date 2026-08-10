package gamedata

// Test-only bridges for the external gamedata_test package. The HTTP
// hardening helpers and YAML roster parsers have no public entry
// point; compiled only under test, so they widen no API.

var (
	UpdateAllowedHost = updateAllowedHost
	VerifySha256      = verifySha256
	ParseRosterNames  = parseRosterNames
)

// ComputeGameDataStatusForTest wraps computeGameDataStatus with a constructed
// mainVersion so the external test can exercise the roster-diff → has_update
// contract without touching the unexported mainVersion type.
func ComputeGameDataStatusForTest(baseDir, commitSHA, committedAt string, heroes, maps, sources []string, seasonsYAML string) Status {
	var seasons []seasonMeta
	if seasonsYAML != "" {
		seasons = parseSeasonMetas([]byte(seasonsYAML))
	}
	return computeGameDataStatus(baseDir, mainVersion{CommitSHA: commitSHA, CommittedAt: committedAt}, heroes, maps, sources, seasons)
}
