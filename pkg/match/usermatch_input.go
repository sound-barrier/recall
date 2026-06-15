package match

// UserMatchDataInput is the wire shape for PUT /matches/{match_key}/data — the
// FULL user override set to apply. Inline edits send the whole current set; a
// per-field revert is the same PUT with that field omitted. Scalar pointers
// distinguish "override to this value" (non-nil, including 0 / "") from "not
// overridden / reverted" (nil). It mirrors db.UserMatchData but lives in the
// domain layer so the JSON contract doesn't leak SQL field names (the same
// reason MatchAnnotation mirrors db.Annotation).
type UserMatchDataInput struct {
	Map           *string             `json:"map,omitempty"`
	Hero          *string             `json:"hero,omitempty"`
	Eliminations  *int                `json:"eliminations,omitempty"`
	Assists       *int                `json:"assists,omitempty"`
	Deaths        *int                `json:"deaths,omitempty"`
	Damage        *int                `json:"damage,omitempty"`
	Healing       *int                `json:"healing,omitempty"`
	Mitigation    *int                `json:"mitigation,omitempty"`
	Result        *string             `json:"result,omitempty"`
	FinalScore    *string             `json:"final_score,omitempty"`
	Date          *string             `json:"date,omitempty"`
	FinishedAt    *string             `json:"finished_at,omitempty"`
	GameLength    *string             `json:"game_length,omitempty"`
	Rank          *string             `json:"rank,omitempty"`
	Level         *int                `json:"level,omitempty"`
	RankProgress  *int                `json:"rank_progress,omitempty"`
	ChangePercent *int                `json:"change_percent,omitempty"`
	Heroes        []UserHeroInput     `json:"heroes,omitempty"`
	HeroStats     []UserHeroStatInput `json:"hero_stats,omitempty"`
	SR            []UserHeroSRInput   `json:"sr,omitempty"`
	Modifiers     []string            `json:"modifiers,omitempty"`
}

// UserHeroInput is one heroes-played LIST entry; position 0 = primary.
type UserHeroInput struct {
	Hero          string  `json:"hero"`
	PercentPlayed *int    `json:"percent_played,omitempty"`
	PlayTime      *string `json:"play_time,omitempty"`
	Position      int     `json:"position"`
}

// UserHeroStatInput is one overridden stat cell, applied independently of the
// heroes-played list.
type UserHeroStatInput struct {
	Hero    string `json:"hero"`
	StatKey string `json:"stat_key"`
	Value   int    `json:"value"`
}

// UserHeroSRInput is one per-hero SR override (editing an OCR rank screen).
type UserHeroSRInput struct {
	Hero   string `json:"hero"`
	SR     int    `json:"sr"`
	Change int    `json:"change"`
}

// ManualMatchInput is the wire shape for POST /matches — a hand-entered match
// for users without OCR. The server derives the match_key from PlayedAt
// (default now). Required: Map, PlayMode, QueueType, Result, and at least one
// hero (Heroes[0] is the primary). Rank is competitive-only and optional.
type ManualMatchInput struct {
	Map       string           `json:"map"`
	PlayMode  string           `json:"play_mode"`  // "competitive" | "quickplay"
	QueueType string           `json:"queue_type"` // "role" | "open"
	Heroes    []string         `json:"heroes"`     // first = primary
	Result    string           `json:"result"`     // "victory" | "defeat" | "draw"
	PlayedAt  string           `json:"played_at,omitempty"`
	Rank      *ManualRankInput `json:"rank,omitempty"`
	// Leaver records who (if anyone) abandoned the match — "self" / "team" /
	// "enemy", or "" for none. Written to the match annotation, not the
	// user-data row (it shares the existing leaver-annotation surface).
	Leaver string `json:"leaver,omitempty"`
}

// ManualRankInput captures the competitive rank a manual match ended on.
type ManualRankInput struct {
	Tier               string `json:"tier"`     // "platinum", "gold", …
	Division           int    `json:"division"` // 1-5 within the tier
	Progress           int    `json:"progress"` // % into the division
	ChangePercent      int    `json:"change_percent"`
	DemotionProtection bool   `json:"demotion_protection"`
}
