package parser

// ScreenshotType is which of Overwatch's end-of-match screens a parse came
// from. It is a named type rather than a bare string because its six values
// are spelled across seven packages — table names, bundle sections, view
// names, the per-type Upsert dispatch — and a bare string let a seventh
// screen be added without any of them noticing (TECHNICAL_DEBT.md section 11).
type ScreenshotType string

const (
	TypeSummary   ScreenshotType = "summary"
	TypeTeams     ScreenshotType = "teams"
	TypePersonal  ScreenshotType = "personal"
	TypeRank      ScreenshotType = "rank"
	TypeAllHeroes ScreenshotType = "all_heroes"
	// TypeUnknown is the parse that matched nothing. It is a real member of
	// the vocabulary, not an error: unknown screenshots get a row, a table and
	// a triage tab of their own.
	TypeUnknown ScreenshotType = "unknown"
)

// ScreenshotTypes is every type, in classification order with unknown last.
// Exported so a completeness test can walk the vocabulary instead of
// re-listing it — the parse-dispatch test covered four of these six for
// months while its name promised all of them.
var ScreenshotTypes = []ScreenshotType{
	TypeAllHeroes, TypeRank, TypeSummary, TypeTeams, TypePersonal, TypeUnknown,
}

// Classify infers the screenshot category from which fields the parser
// populated.
//
// Pure function over a MatchResult; the persistence layer dispatches to the
// matching per-type Upsert based on the return value, and the
// integration-test golden files capture this output to gate parser
// regressions that would shift classification.
func Classify(r *MatchResult) ScreenshotType {
	if r == nil {
		return TypeUnknown
	}
	for _, c := range screenshotTypeChecks {
		if c.match(r) {
			return c.name
		}
	}
	return TypeUnknown
}

// screenshotTypeChecks is the ordered field-sniffing ladder Classify walks;
// the first matching entry names the type.
//
// Order is load-bearing: a TEAMS parse populates BOTH the E/A/D
// combat row AND the right-side panel's per-hero stats
// (HeroesPlayed[*].Stats), while a PERSONAL parse only populates the
// per-hero stats. The E/A/D check therefore MUST run before the
// hero-stats check — flipping the two would mis-classify every
// teams with a populated panel as "personal".
var screenshotTypeChecks = []struct {
	name  ScreenshotType
	match func(*MatchResult) bool
}{
	{TypeAllHeroes, func(r *MatchResult) bool { return r.AllHeroes }},
	// The parseRank marker outranks field sniffing: a rank screen whose
	// tier OCR garbled still has rank-shaped partials (result pill,
	// progress, SR cards) that would otherwise land it in summary/unknown.
	// r.Rank != "" stays for results built from stored rows, which never
	// carry parse-time markers.
	{TypeRank, func(r *MatchResult) bool { return r.RankScreen || r.Rank != "" }},
	{TypeSummary, func(r *MatchResult) bool { return r.Result != "" || r.Date != "" || r.GameLength != "" }},
	{TypeTeams, func(r *MatchResult) bool { return r.Eliminations > 0 || r.Assists > 0 || r.Deaths > 0 || r.Damage > 0 }},
	{TypePersonal, hasHeroStats},
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
