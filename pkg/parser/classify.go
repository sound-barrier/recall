package parser

// ScreenshotType infers the screenshot category from which fields the
// parser populated. Returns one of "rank" / "summary" / "teams" /
// "personal" / "unknown".
//
// Pure function over a MatchResult; the persistence layer dispatches
// to the matching per-type Upsert based on the return value, and the
// integration-test golden files capture this output to gate parser
// regressions that would shift classification.
func ScreenshotType(r *MatchResult) string {
	if r == nil {
		return "unknown"
	}
	for _, c := range screenshotTypeChecks {
		if c.match(r) {
			return c.name
		}
	}
	return "unknown"
}

// screenshotTypeChecks is the ordered field-sniffing ladder ScreenshotType
// walks; the first matching entry names the type.
//
// Order is load-bearing: a TEAMS parse populates BOTH the E/A/D
// combat row AND the right-side panel's per-hero stats
// (HeroesPlayed[*].Stats), while a PERSONAL parse only populates the
// per-hero stats. The E/A/D check therefore MUST run before the
// hero-stats check — flipping the two would mis-classify every
// teams with a populated panel as "personal".
var screenshotTypeChecks = []struct {
	name  string
	match func(*MatchResult) bool
}{
	{"all_heroes", func(r *MatchResult) bool { return r.AllHeroes }},
	// The parseRank marker outranks field sniffing: a rank screen whose
	// tier OCR garbled still has rank-shaped partials (result pill,
	// progress, SR cards) that would otherwise land it in summary/unknown.
	// r.Rank != "" stays for results built from stored rows, which never
	// carry parse-time markers.
	{"rank", func(r *MatchResult) bool { return r.RankScreen || r.Rank != "" }},
	{"summary", func(r *MatchResult) bool { return r.Result != "" || r.Date != "" || r.GameLength != "" }},
	{"teams", func(r *MatchResult) bool { return r.Eliminations > 0 || r.Assists > 0 || r.Deaths > 0 || r.Damage > 0 }},
	{"personal", hasHeroStats},
}

// hasHeroStats reports whether any played hero carries per-hero stats — the
// PERSONAL tab's signature once the teams check has been ruled out.
func hasHeroStats(r *MatchResult) bool {
	for _, hp := range r.HeroesPlayed {
		if len(hp.Stats) > 0 {
			return true
		}
	}
	return false
}
