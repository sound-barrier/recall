package parser

// Per-screenshot-type projections of MatchResult. Each shape includes
// only the fields the corresponding `parse_<type>.go` actually
// populates — no zero-valued "field this type can't see" noise in the
// golden JSON.
//
// Maintenance rule: when a `parse_<type>.go` starts populating a new
// MatchResult field, add it here, run `make update-goldens`, and
// commit the diff. The integration test will fail loudly on the next
// run if the per-type shape and what the parser populates drift apart.
//
// `omitempty` is used on container fields (HeroesPlayed, Modifiers,
// SR, Performance) so a screenshot that legitimately captures none of
// that data renders cleanly. Scalar fields are always emitted because
// `mode: ""` (failed mode-OCR) is materially different from "mode
// field unsupported by this screenshot type" — the per-type shape
// makes the distinction.

// SummaryGolden is the golden JSON shape for a SUMMARY parse.
//
// Populated by `parse_summary.go`: map, type, mode, role, hero,
// E/A/D (lifted from `performance.*.total`), result, final_score,
// date, finished_at, game_length, heroes_played, performance.
// NOT extracted: damage, healing, mitigation, rank/sr fields.
type SummaryGolden struct {
	Map          string       `json:"map"`
	Type         string       `json:"type"`
	Mode         string       `json:"mode"`
	Role         string       `json:"role"`
	Hero         string       `json:"hero"`
	Eliminations int          `json:"eliminations"`
	Assists      int          `json:"assists"`
	Deaths       int          `json:"deaths"`
	Result       string       `json:"result"`
	FinalScore   string       `json:"final_score"`
	Date         string       `json:"date"`
	FinishedAt   string       `json:"finished_at"`
	GameLength   string       `json:"game_length"`
	HeroesPlayed []HeroPlay   `json:"heroes_played,omitempty"`
	Performance  *Performance `json:"performance,omitempty"`
}

// ScoreboardGolden is the golden JSON shape for a TEAMS/in-game
// scoreboard parse.
//
// Populated by `parse_scoreboard.go`: map+type+mode (from the header
// banner; may fail and leave empty), hero+role (from the highlighted
// row + right panel), the six combat-stat columns, queue_type (from
// the players-per-team count; empty when unread), plus heroes_played
// with the right-panel hero stats on the in-game variant. NOT
// extracted:
// result, final_score, date/finished_at/game_length, performance,
// rank/sr fields.
type ScoreboardGolden struct {
	Map          string     `json:"map"`
	Type         string     `json:"type"`
	Mode         string     `json:"mode"`
	Role         string     `json:"role"`
	Hero         string     `json:"hero"`
	Eliminations int        `json:"eliminations"`
	Assists      int        `json:"assists"`
	Deaths       int        `json:"deaths"`
	Damage       int        `json:"damage"`
	Healing      int        `json:"healing"`
	Mitigation   int        `json:"mitigation"`
	QueueType    string     `json:"queue_type"`
	HeroesPlayed []HeroPlay `json:"heroes_played,omitempty"`
}

// PersonalGolden is the golden JSON shape for a PERSONAL parse.
//
// Populated by `parse_personal.go`: mode (from the badge), hero+role
// (from the heroes panel + hero-role lookup), heroes_played with
// percent_played/play_time/stats. NOT extracted: map, type, E/A/D,
// damage/healing/mitigation, result/score/date, performance, rank/sr
// fields.
type PersonalGolden struct {
	Mode         string     `json:"mode"`
	Role         string     `json:"role"`
	Hero         string     `json:"hero"`
	HeroesPlayed []HeroPlay `json:"heroes_played,omitempty"`
}

// RankGolden is the golden JSON shape for a competitive RANK parse.
//
// Populated by `parse_rank.go`: mode (always "competitive"), result
// (victory/defeat/draw from the banner), rank tier, level, rank
// progress %, change %, modifiers, per-hero SR, hero+role (lifted
// from SR[0]). NOT extracted: map, type, E/A/D, damage/healing/
// mitigation, score/date/finished_at/game_length, performance,
// heroes_played.
type RankGolden struct {
	Mode          string   `json:"mode"`
	Result        string   `json:"result"`
	Hero          string   `json:"hero"`
	Role          string   `json:"role"`
	Rank          string   `json:"rank"`
	Level         int      `json:"level"`
	RankProgress  int      `json:"rank_progress"`
	ChangePercent int      `json:"change_percent"`
	Modifiers     []string `json:"modifiers,omitempty"`
	SR            []HeroSR `json:"sr,omitempty"`
}

// ToGolden projects a parsed MatchResult onto its screenshot-type
// golden shape. The returned `any` holds one of *SummaryGolden,
// *ScoreboardGolden, *PersonalGolden, *RankGolden, or — when
// ScreenshotType returns "unknown" — the raw *MatchResult so an
// unclassified fixture still captures every field for diagnosis.
func ToGolden(r *MatchResult) any {
	if r == nil {
		return &MatchResult{}
	}
	switch ScreenshotType(r) {
	case "summary":
		return &SummaryGolden{
			Map:          r.Map,
			Type:         r.Type,
			Mode:         r.Mode,
			Role:         r.Role,
			Hero:         r.Hero,
			Eliminations: r.Eliminations,
			Assists:      r.Assists,
			Deaths:       r.Deaths,
			Result:       r.Result,
			FinalScore:   r.FinalScore,
			Date:         r.Date,
			FinishedAt:   r.FinishedAt,
			GameLength:   r.GameLength,
			HeroesPlayed: r.HeroesPlayed,
			Performance:  r.Performance,
		}
	case "scoreboard":
		return &ScoreboardGolden{
			Map:          r.Map,
			Type:         r.Type,
			Mode:         r.Mode,
			Role:         r.Role,
			Hero:         r.Hero,
			Eliminations: r.Eliminations,
			Assists:      r.Assists,
			Deaths:       r.Deaths,
			Damage:       r.Damage,
			Healing:      r.Healing,
			Mitigation:   r.Mitigation,
			QueueType:    r.QueueType,
			HeroesPlayed: r.HeroesPlayed,
		}
	case "personal":
		return &PersonalGolden{
			Mode:         r.Mode,
			Role:         r.Role,
			Hero:         r.Hero,
			HeroesPlayed: r.HeroesPlayed,
		}
	case "rank":
		return &RankGolden{
			Mode:          r.Mode,
			Result:        r.Result,
			Hero:          r.Hero,
			Role:          r.Role,
			Rank:          r.Rank,
			Level:         r.Level,
			RankProgress:  r.RankProgress,
			ChangePercent: r.ChangePercent,
			Modifiers:     r.Modifiers,
			SR:            r.SR,
		}
	default:
		return r
	}
}
