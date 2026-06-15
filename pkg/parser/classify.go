package parser

// ScreenshotType infers the screenshot category from which fields the
// parser populated. Returns one of "rank" / "summary" / "teams" /
// "personal" / "unknown".
//
// Order is load-bearing: a TEAMS parse populates BOTH the E/A/D
// combat row AND the right-side panel's per-hero stats
// (HeroesPlayed[*].Stats), while a PERSONAL parse only populates the
// per-hero stats. The E/A/D check therefore MUST run before the
// hero-stats check — flipping the two would mis-classify every
// teams with a populated panel as "personal".
//
// Pure function over a MatchResult; the persistence layer dispatches
// to the matching per-type Upsert based on the return value, and the
// integration-test golden files capture this output to gate parser
// regressions that would shift classification.
func ScreenshotType(r *MatchResult) string {
	if r == nil {
		return "unknown"
	}
	if r.AllHeroes {
		return "all_heroes"
	}
	if r.Rank != "" {
		return "rank"
	}
	if r.Result != "" || r.Date != "" || r.GameLength != "" {
		return "summary"
	}
	if r.Eliminations > 0 || r.Assists > 0 || r.Deaths > 0 || r.Damage > 0 {
		return "teams"
	}
	for _, hp := range r.HeroesPlayed {
		if len(hp.Stats) > 0 {
			return "personal"
		}
	}
	return "unknown"
}
