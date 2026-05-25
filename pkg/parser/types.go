package parser

type MatchResult struct {
	Map          string `json:"map"`
	Type         string `json:"type"`
	Mode         string `json:"mode"` // "competitive" or "quickplay"
	Role         string `json:"role"`
	Hero         string `json:"hero"`
	Eliminations int    `json:"eliminations"`
	Assists      int    `json:"assists"`
	Deaths       int    `json:"deaths"`
	Damage       int    `json:"damage"`
	Healing      int    `json:"healing"`
	Mitigation   int    `json:"mitigation"`

	// Summary-screen-only fields. Empty on a scoreboard parse.
	Result       string       `json:"result,omitempty"`      // "victory", "defeat", or "draw"
	FinalScore   string       `json:"final_score,omitempty"` // e.g. "3-1"
	Date         string       `json:"date,omitempty"`        // ISO date, e.g. "2026-05-10"
	FinishedAt   string       `json:"finished_at,omitempty"` // HH:MM 24h, as shown by the client
	GameLength   string       `json:"game_length,omitempty"` // MM:SS
	HeroesPlayed []HeroPlay   `json:"heroes_played,omitempty"`
	Performance  *Performance `json:"performance,omitempty"`

	// Competitive rank-screen fields. Populated only by parseRank for the
	// post-match competitive rank progress screen.
	Rank          string   `json:"rank,omitempty"`           // tier name: platinum, gold, etc.
	Level         int      `json:"level,omitempty"`          // sub-division within tier (1-5)
	Modifiers     []string `json:"modifiers,omitempty"`      // ["expected", "victory"], etc.
	RankProgress  int      `json:"rank_progress,omitempty"`  // % into current level
	ChangePercent int      `json:"change_percent,omitempty"` // % the rank moved this match
	SR            []HeroSR `json:"sr,omitempty"`             // per-hero SR + change
}

type HeroSR struct {
	Hero   string `json:"hero"`
	SR     int    `json:"sr"`
	Change int    `json:"change"`
}

type HeroPlay struct {
	Hero          string `json:"hero"`
	PercentPlayed int    `json:"percent_played"`
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
