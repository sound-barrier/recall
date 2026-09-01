package parser

import "fmt"

// Generation identifies the parser's OUTPUT vintage. Bump it when a re-parse
// would change something the USER WOULD NOTICE — a corrected reading, a crop
// retuned, a field that used to come back wrong or empty and now carries a
// value they act on.
//
// "Anything a re-parse would change" is the rule this comment used to state, and
// it is too wide. The count built on this constant flags a MATCH when any of its
// rows is behind, and the notice tells the user a re-parse would improve them —
// so bumping for a change they cannot see spends the whole corpus's worth of
// attention on nothing. A purely DIAGNOSTIC field is the case where the two
// readings diverge: modifiers_raw ships forward-only for exactly this reason,
// and its value is populated on 3 of 44 rank captures, all three of them known
// false positives. The next modifiers.yaml addition earns the bump instead,
// because that one changes stored modifiers the filters and dossier count.
//
// It exists because a parser improvement reaches only files parsed AFTER it
// ships. Nothing told the user that, so a fix silently applied to new captures
// while their history kept the old readings and every chart quietly mixed the
// two. Stamped on each screenshot row at parse time, it lets the app say which
// rows a Re-parse All would actually improve.
//
// Deliberately NOT the app version: a release that never touches the parser
// would flag every row as stale, and an alarm that fires when nothing changed
// trains the reader to ignore the one that matters. This is a decision someone
// makes, which is why it is a hand-bumped constant.
//
// 1: signed, nullable rank movement and progress (an unread pill stopped
//
//	claiming the rank moved by nothing).
const Generation = 1

type MatchResult struct {
	Map string `json:"map"`
	// MapRaw holds the raw OCR'd text that the parser tried to match
	// against the canonical map roster (pkg/parser/maps.yaml). Always
	// populated when the parser saw something map-ish; canonical Map
	// is empty when the matcher couldn't pin it to a known entry.
	// The downstream "Unknown map (newmap?)" UI reads this; a future
	// YAML release can re-aggregate the corpus and promote stored
	// MapRaw values to canonical Map without re-OCRing the PNG.
	MapRaw   string `json:"map_raw,omitempty"`
	GameMode string `json:"game_mode"`
	Playlist string `json:"playlist"` // "competitive" or "quickplay"
	Role     string `json:"role"`
	Hero     string `json:"hero"`
	// HeroRaw mirrors MapRaw — raw OCR'd hero text. Empty Hero +
	// non-empty HeroRaw is the "Unknown hero" signal (e.g. a
	// Miyazaki play parsed before heroes.yaml is updated). Single
	// hero only — per-hero raw OCR for multi-hero panels lives on
	// HeroPlay.HeroRaw below.
	HeroRaw      string `json:"hero_raw,omitempty"`
	Eliminations int    `json:"eliminations"`
	Assists      int    `json:"assists"`
	Deaths       int    `json:"deaths"`
	Damage       int    `json:"damage"`
	Healing      int    `json:"healing"`
	Mitigation   int    `json:"mitigation"`

	// QueueType is the match format inferred from the teams
	// players-per-team count: "role" (5v5) or "open" (6v6). Empty when
	// the screenshot isn't a teams or the count couldn't be read.
	// A user-set queue annotation overrides this at read time.
	QueueType string `json:"queue_type,omitempty"`

	// Summary-screen-only fields. Empty on a teams parse.
	Result     string `json:"result,omitempty"`      // "victory", "defeat", or "draw"
	FinalScore string `json:"final_score,omitempty"` // e.g. "3-1"
	Date       string `json:"date,omitempty"`        // ISO date, e.g. "2026-05-10"
	FinishedAt string `json:"finished_at,omitempty"` // HH:MM 24h, as shown by the client
	GameLength string `json:"game_length,omitempty"` // MM:SS
	// PlayedAtUTC is the canonical UTC instant (RFC3339), derived at parse
	// time from Date+FinishedAt via the machine timezone identity. Empty when
	// no instant is derivable. The FE renders it in the user's current zone
	// and uses it for season assignment; Date/FinishedAt stay naive-local.
	PlayedAtUTC  string       `json:"played_at_utc,omitempty"`
	HeroesPlayed []HeroPlay   `json:"heroes_played,omitempty"`
	Performance  *Performance `json:"performance,omitempty"`

	// Competitive rank-screen fields. Populated only by parseRank for the
	// post-match competitive rank progress screen.
	Rank      string   `json:"rank,omitempty"`      // tier name: platinum, gold, etc.
	Level     int      `json:"level,omitempty"`     // sub-division within tier (1-5)
	Modifiers []string `json:"modifiers,omitempty"` // ["expected", "victory"], etc.
	// ModifiersRaw holds the chip-like words in the modifier row that NO
	// modifier in this release's vocabulary accounts for, space-joined in band
	// order. It is not a modifier and must never be merged into Modifiers — the
	// only thing known about it is that modifiers.yaml could not explain it.
	//
	// Sibling of MapRaw / HeroRaw, and for the same reason: an OCR reading the
	// canonical table cannot place is evidence, not noise. Season 4's VARIANCE
	// chip rode every post-placement rank screen for a season because this text
	// existed only in a log line. One difference from those two — there is no
	// boot-time promotion pass that turns this into a real modifier when the
	// vocabulary catches up; a re-parse is what reclassifies it.
	ModifiersRaw string `json:"modifiers_raw,omitempty"`
	// RankProgress (% into the current level) and ChangePercent (% the rank
	// moved this match) are pointers for the same reason RankPercentile is: 0 is
	// a REAL reading for both — the bottom of a division, and a match that moved
	// the rank by nothing — so a plain int cannot say "this screen did not
	// report it". It read as one for a long time: 21 of 44 rank captures store a
	// change of 0 because the movement caption was never recovered, and any
	// consumer that trusted the number was told those matches moved the rank
	// exactly nowhere.
	RankProgress  *int     `json:"rank_progress,omitempty"`
	ChangePercent *int     `json:"change_percent,omitempty"`
	SR            []HeroSR `json:"sr,omitempty"` // per-hero SR + change
	// RankPercentile is the share of players ranked BELOW this one, from the
	// season-4 "HIGHER RANKED THAN 57% OF PLAYERS" caption. nil = the screen
	// carried no such caption (every placement screen), which is distinct from
	// 0 ("above nobody") — hence the pointer.
	RankPercentile *int `json:"rank_percentile,omitempty"`

	// AllHeroes marks the PERSONAL "All Heroes" aggregate view — recognized
	// so it stays out of the Unknown tab, but its stats are deliberately not
	// parsed (redundant with TEAMS; the cards' icons defeat the OCR). The
	// write path skips storing it.
	AllHeroes bool `json:"all_heroes,omitempty"`

	// RankScreen marks that parseRank produced this result, so classification
	// survives a garbled tier read: without it, a rank screen whose division
	// text OCR'd to nothing masquerades as a summary (readable result pill)
	// or unknown (nothing readable), and the fake row poisons correlation.
	// Parse-time only — never stored; mirrors the AllHeroes marker.
	RankScreen bool `json:"rank_screen,omitempty"`

	// Warnings records non-fatal degradations of a parse that still
	// SUCCEEDED — a stat cell whose OCR failed, a hero card that resolved a
	// name but lost its timing. The screenshot is stored (a missing stat must
	// not block the match from landing), but the app copies these into the
	// failed-files ledger so the file surfaces in the Unknown tab's triage
	// list for a deliberate re-parse instead of silently counting as clean.
	//
	// `json:"-"`: this is a parser→app signal, not match data. It is never
	// stored, never on the REST/Wails wire, and absent from the golden
	// projections — the user-visible shape is the ledger row (app.FailedFile).
	Warnings []string `json:"-"`
}

// warnf appends one non-fatal parse warning. Callers use it where the
// alternative is dropping an OCR failure on the floor.
func (r *MatchResult) warnf(format string, args ...any) {
	r.Warnings = append(r.Warnings, fmt.Sprintf(format, args...))
}

type HeroSR struct {
	Hero string `json:"hero"`
	SR   int    `json:"sr"`
	// Change is the SR the pill said this hero moved. A POINTER for the same
	// reason ChangePercent is one: the pill is often unreadable, and a bare
	// int stored 0 for "we could not read it" — indistinguishable from a match
	// that genuinely moved nothing. Nearly half the rank captures in the
	// corpus were storing that 0, and every reader downstream counted them as
	// measured flatness.
	Change *int `json:"change,omitempty"`
}

type HeroPlay struct {
	Hero string `json:"hero"`
	// HeroRaw — raw OCR'd hero text for this entry. Always set when
	// the heroes_played panel was OCR'd; Hero is empty when the
	// matcher rejected the candidate as unknown.
	HeroRaw string `json:"hero_raw,omitempty"`
	// PercentPlayed is omitted (not 0) for heroes known only by name — the
	// PERSONAL sidebar roster lists every hero played but shows no per-hero
	// %, so 0 would read as "played 0%" and could be filtered as not-played.
	// A real entry's % is always > 0; read-time merge fills it from the
	// SUMMARY when a later screenshot of the match supplies it.
	PercentPlayed int    `json:"percent_played,omitempty"`
	PlayTime      string `json:"play_time,omitempty"`
	// Stats holds hero-specific stats from the PERSONAL tab. Keys are
	// snake_case label-derived (e.g. "WEAPON ACCURACY" → "weapon_accuracy");
	// the shape is open because every hero has its own card set. Nested per
	// HeroPlay (rather than a flat top-level map) so multi-hero matches keep
	// each hero's stats distinct.
	Stats map[string]int `json:"stats,omitempty"`
}

type Performance struct {
	Eliminations PerformanceStat `json:"eliminations"`
	Assists      PerformanceStat `json:"assists"`
	Deaths       PerformanceStat `json:"deaths"`
}

type PerformanceStat struct {
	Total       int     `json:"total"`
	AvgPer10Min float64 `json:"avg_per_10min,omitempty"`
}
