package match

// UserMatchDataInput is the wire shape for PUT /matches/{match_key}/data — the
// FULL user override set to apply. Inline edits send the whole current set; a
// per-field revert is the same PUT with that field omitted. Scalar pointers
// distinguish "override to this value" (non-nil, including 0 / "") from "not
// overridden / reverted" (nil). It mirrors db.UserMatchData but lives in the
// domain layer so the JSON contract doesn't leak SQL field names (the same
// reason Annotation mirrors db.Annotation).
type UserMatchDataInput struct {
	Map          *string `json:"map,omitempty"`
	Hero         *string `json:"hero,omitempty"`
	Eliminations *int    `json:"eliminations,omitempty"`
	Assists      *int    `json:"assists,omitempty"`
	Deaths       *int    `json:"deaths,omitempty"`
	Damage       *int    `json:"damage,omitempty"`
	Healing      *int    `json:"healing,omitempty"`
	Mitigation   *int    `json:"mitigation,omitempty"`
	Result       *string `json:"result,omitempty"`
	FinalScore   *string `json:"final_score,omitempty"`
	Date         *string `json:"date,omitempty"`
	FinishedAt   *string `json:"finished_at,omitempty"`
	GameLength   *string `json:"game_length,omitempty"`
	// PlayedAtUTC is the canonical instant. Carried so a manual entry's
	// EXACT moment — computed from the wire offset, which is information the
	// wall clock cannot reproduce — survives a later edit. Omit it and the
	// store derives one from date + finished_at in the machine's zone.
	PlayedAtUTC   *string             `json:"played_at_utc,omitempty"`
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
	// Leavers / Throwers record who (if anyone) abandoned or threw the match —
	// any of "self" / "team" / "enemy", empty for none. Sets, not scalars: the
	// leaver-exit quick-add records "a teammate left, then I left" as both
	// sides at once. Written to the match annotation, not the user-data row.
	Leavers  []string `json:"leavers,omitempty"`
	Throwers []string `json:"throwers,omitempty"`
	// Optional annotation fields, written to the match-annotation surface
	// alongside the disruption sides (the same one the detail-panel choosers
	// edit after creation). Empty values are dropped by SetMatchAnnotation.
	ReplayCode string   `json:"replay_code,omitempty"`
	Note       string   `json:"note,omitempty"`
	Tags       []string `json:"tags,omitempty"`
	Members    []string `json:"members,omitempty"` // the squad / group the user played with
}

// ReplayMatchInput is what a coach's review knows about a match the player
// does not have: a replay code, and whatever the coach wrote down while
// watching it.
//
// A sibling of ManualMatchInput rather than a reuse, because the two differ
// in every field that matters. A manual match is minted from a wall clock
// the PLAYER supplies and refuses a key that already exists; this one is
// minted from the code, so the key is deterministic and a second import of
// the same archive has to be a quiet no-op. And a manual match requires a
// map and a result — the player was there — where a coach may legitimately
// have observed only that the match happened.
type ReplayMatchInput struct {
	// Code is the replay the review is about, and the only required field.
	Code string `json:"replay_code"`
	// What the coach observed. Each optional; each still validated when
	// present, so a context that reaches here is one the roster knows.
	Map        string `json:"map,omitempty"`
	Hero       string `json:"hero,omitempty"`
	Result     string `json:"result,omitempty"`
	Date       string `json:"date,omitempty"`
	FinishedAt string `json:"finished_at,omitempty"`
}

// ManualRankInput captures the competitive rank a manual match ended on.
type ManualRankInput struct {
	Tier               string `json:"tier"`     // "platinum", "gold", …
	Division           int    `json:"division"` // 1-5 within the tier
	Progress           int    `json:"progress"` // % into the division
	ChangePercent      int    `json:"change_percent"`
	DemotionProtection bool   `json:"demotion_protection"`
}
