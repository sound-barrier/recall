package app

import (
	"errors"
	"fmt"
	"time"

	"recall/pkg/db"
	"recall/pkg/match"
	"recall/pkg/parser"
)

// validResults enumerates the three match outcomes. The empty string is not a
// valid override — omit the field to leave the OCR result untouched.
var validResults = map[string]bool{"victory": true, "defeat": true, "draw": true}

// Numeric bounds mirrored from the request / MatchResult schemas in
// api/openapi.yaml. The override layer echoes overrides straight into the
// response, so anything outside these would emit a schema-violating record.
const (
	statMin, statMax     = 0, 1_000_000          // E/A/D, damage, healing, mitigation, hero-stat value, SR
	levelMin, levelMax   = 0, 5                  // level (rank division)
	pctMin, pctMax       = 0, 100                // rank_progress, percent_played
	changeMin, changeMax = -1_000_000, 1_000_000 // change_percent, SR change
)

func inRange(v, lo, hi int) bool         { return v >= lo && v <= hi }
func ptrInRange(p *int, lo, hi int) bool { return p == nil || inRange(*p, lo, hi) }

var (
	// ErrMatchKeyRequired is returned when a match_key path param is empty.
	ErrMatchKeyRequired = errors.New("match_key required")
	// ErrInvalidResult maps to 400 — result must be victory / defeat / draw.
	ErrInvalidResult = errors.New("invalid result: must be 'victory', 'defeat', or 'draw'")
	// ErrManualNeedsMap maps to 400 — a manual match must name its map.
	ErrManualNeedsMap = errors.New("map is required")
	// ErrManualNeedsHero maps to 400 — a manual match needs at least one hero.
	ErrManualNeedsHero = errors.New("at least one hero is required")
	// ErrMatchKeyExists maps to 409 — a match already exists at that time.
	ErrMatchKeyExists = errors.New("a match already exists for that time; pick a different minute")
	// ErrInvalidPlayedAt maps to 400 — played_at wasn't valid RFC 3339.
	ErrInvalidPlayedAt = errors.New("invalid played_at: must be RFC 3339")
	// ErrInvalidRank maps to 400 — a manual rank value falls outside the bounds
	// the MatchResult response promises (level 0-5, rank_progress 0-100,
	// change_percent ±1_000_000). The create path echoes these straight back, so
	// an out-of-range input would emit a schema-violating response.
	ErrInvalidRank = errors.New("invalid rank: division, progress, or change_percent out of range")
	// ErrStatOutOfRange maps to 400 — an overridden numeric stat falls outside
	// the bounds api/openapi.yaml documents for the MatchResult response, which
	// the override layer echoes back verbatim.
	ErrStatOutOfRange = errors.New("invalid stat: a numeric value is out of range")
	// ErrUnknownMap maps to 409 — the map isn't in the Overwatch roster. 409
	// (not 400) because the value is spec-valid free-text the server can't accept.
	ErrUnknownMap = errors.New("unknown map: not in the Overwatch roster")
	// ErrUnknownHero maps to 409 — the hero isn't in the Overwatch roster.
	ErrUnknownHero = errors.New("unknown hero: not in the Overwatch roster")
)

// UpdateMatchData replaces the user override set for a match (inline edits send
// the full current set; a per-field revert is the same call with that field
// omitted). The override layer is kept separate from the parsed OCR rows, so a
// later ResetMatchData restores the original. Emits the re-aggregated record.
func (a *App) UpdateMatchData(matchKey string, input match.UserMatchDataInput) error {
	if matchKey == "" {
		return ErrMatchKeyRequired
	}
	if input.Result != nil && !validResults[*input.Result] {
		return ErrInvalidResult
	}
	if err := validateUserMatchData(input); err != nil {
		return err
	}
	if err := a.store.UpsertUserMatchData(userMatchDataFromInput(matchKey, input)); err != nil {
		return err
	}
	a.emitMatchByKey(matchKey)
	return nil
}

// ResetMatchData clears the user override set for a match — reverting an edited
// OCR match to pure OCR. (Deleting a hand-entered match is HardDeleteMatch, which
// also clears its queue / play-mode aux rows.) Idempotent.
func (a *App) ResetMatchData(matchKey string) error {
	if matchKey == "" {
		return ErrMatchKeyRequired
	}
	if err := a.store.DeleteUserMatchData(matchKey); err != nil {
		return err
	}
	a.emitMatchByKey(matchKey)
	return nil
}

// CreateManualMatch hand-enters a match for users without OCR. It derives the
// match_key from PlayedAt (default now), rejects a collision with any existing
// match (so the user picks a different minute), writes the override row plus the
// queue / play-mode aux rows, and returns the aggregated record. The right-side
// detail-panel choosers then work unchanged — they key on match_key.
func (a *App) CreateManualMatch(input match.ManualMatchInput) (match.MatchRecord, error) {
	key, data, err := buildManualMatch(input)
	if err != nil {
		return match.MatchRecord{}, err
	}
	exists, err := a.store.MatchKeyExists(key)
	if err != nil {
		return match.MatchRecord{}, err
	}
	if exists {
		return match.MatchRecord{}, ErrMatchKeyExists
	}
	if err := a.store.UpsertUserMatchData(data); err != nil {
		return match.MatchRecord{}, err
	}
	if err := a.store.SetMatchPlayMode(key, input.PlayMode); err != nil {
		return match.MatchRecord{}, err
	}
	if err := a.store.SetMatchQueue(key, input.QueueType); err != nil {
		return match.MatchRecord{}, err
	}
	// Leaver + the optional annotation fields (replay code / note / tags /
	// the squad they grouped with) all ride the existing annotation surface
	// in one upsert — the same row the detail-panel choosers edit later.
	if input.Leaver != "" || input.ReplayCode != "" || input.Note != "" || len(input.Tags) > 0 || len(input.Members) > 0 {
		if err := a.SetMatchAnnotation(AnnotationInput{
			MatchKey:   key,
			Leaver:     input.Leaver,
			ReplayCode: input.ReplayCode,
			Note:       input.Note,
			Tags:       input.Tags,
			Members:    input.Members,
		}); err != nil {
			return match.MatchRecord{}, err
		}
	}
	rec, err := a.GetMatchByKey(key)
	if err != nil {
		return match.MatchRecord{}, err
	}
	a.emitMatchUpdated(rec)
	return rec, nil
}

// validateManualMatchInput checks the manual form's required identity fields,
// enum membership, rank ranges, and map/hero roster membership.
func validateManualMatchInput(input match.ManualMatchInput) error {
	switch {
	case input.Map == "":
		return ErrManualNeedsMap
	case len(input.Heroes) == 0 || input.Heroes[0] == "":
		return ErrManualNeedsHero
	case !validResults[input.Result]:
		return ErrInvalidResult
	case !validPlayModes[input.PlayMode]:
		return ErrInvalidPlayMode
	case !validQueueTypes[input.QueueType]:
		return ErrInvalidQueueType
	case input.Leaver != "" && !validLeavers[input.Leaver]:
		return ErrInvalidLeaver
	}
	if input.Rank != nil {
		if err := validateManualRank(*input.Rank); err != nil {
			return err
		}
	}
	if !parser.IsKnownMap(input.Map) {
		return ErrUnknownMap
	}
	for _, h := range input.Heroes {
		if h != "" && !parser.IsKnownHero(h) {
			return ErrUnknownHero
		}
	}
	return nil
}

// buildManualMatch validates the manual form and converts it into a match_key +
// override row.
func buildManualMatch(input match.ManualMatchInput) (string, db.UserMatchData, error) {
	if err := validateManualMatchInput(input); err != nil {
		return "", db.UserMatchData{}, err
	}

	played := time.Now().UTC()
	if input.PlayedAt != "" {
		parsed, err := time.Parse(time.RFC3339, input.PlayedAt)
		if err != nil {
			return "", db.UserMatchData{}, fmt.Errorf("%w (%v)", ErrInvalidPlayedAt, err)
		}
		played = parsed.UTC()
	}
	key := match.NewTrackedMatchKey(played.Format("2006-01-02T15-04-05")).String()

	mapName, primary, result := input.Map, input.Heroes[0], input.Result
	date, finished := played.Format("2006-01-02"), played.Format("15:04")
	data := db.UserMatchData{
		MatchKey:   key,
		Map:        &mapName,
		Hero:       &primary,
		Result:     &result,
		Date:       &date,
		FinishedAt: &finished,
	}
	for i, h := range input.Heroes {
		if h != "" {
			data.Heroes = append(data.Heroes, db.UserMatchHero{Hero: h, Position: i})
		}
	}
	if input.Rank != nil {
		applyManualRank(&data, *input.Rank)
	}
	return key, data, nil
}

// validateManualRank rejects rank values outside the bounds the MatchResult
// response documents (level 0-5, rank_progress 0-100, change_percent
// ±1_000_000). applyManualRank echoes the input straight into the response, so
// an unchecked value would otherwise produce a schema-violating record.
func validateManualRank(rank match.ManualRankInput) error {
	switch {
	case !inRange(rank.Progress, pctMin, pctMax),
		!inRange(rank.Division, levelMin, levelMax),
		!inRange(rank.ChangePercent, changeMin, changeMax):
		return ErrInvalidRank
	}
	return nil
}

// validateUserMatchData rejects override values that would round-trip into a
// MatchResult response outside its documented bounds — a numeric stat out of
// range (→ ErrStatOutOfRange) or a map/hero not in the roster (→ ErrUnknownMap
// / ErrUnknownHero). Only set fields are checked: a nil pointer or "" means
// "not overridden / cleared".
func validateUserMatchData(in match.UserMatchDataInput) error {
	if err := validateNumericRanges(in); err != nil {
		return err
	}
	return validateRosterFields(in)
}

func validateNumericRanges(in match.UserMatchDataInput) error {
	scalars := []struct {
		v      *int
		lo, hi int
	}{
		{in.Eliminations, statMin, statMax},
		{in.Assists, statMin, statMax},
		{in.Deaths, statMin, statMax},
		{in.Damage, statMin, statMax},
		{in.Healing, statMin, statMax},
		{in.Mitigation, statMin, statMax},
		{in.Level, levelMin, levelMax},
		{in.RankProgress, pctMin, pctMax},
		{in.ChangePercent, changeMin, changeMax},
	}
	for _, s := range scalars {
		if !ptrInRange(s.v, s.lo, s.hi) {
			return ErrStatOutOfRange
		}
	}
	for _, h := range in.Heroes {
		if !ptrInRange(h.PercentPlayed, pctMin, pctMax) {
			return ErrStatOutOfRange
		}
	}
	for _, st := range in.HeroStats {
		if !inRange(st.Value, statMin, statMax) {
			return ErrStatOutOfRange
		}
	}
	for _, sr := range in.SR {
		if !inRange(sr.SR, statMin, statMax) || !inRange(sr.Change, changeMin, changeMax) {
			return ErrStatOutOfRange
		}
	}
	return nil
}

func validateRosterFields(in match.UserMatchDataInput) error {
	if in.Map != nil && *in.Map != "" && !parser.IsKnownMap(*in.Map) {
		return ErrUnknownMap
	}
	heroes := make([]string, 0, len(in.Heroes)+len(in.HeroStats)+len(in.SR)+1)
	if in.Hero != nil {
		heroes = append(heroes, *in.Hero)
	}
	for _, h := range in.Heroes {
		heroes = append(heroes, h.Hero)
	}
	for _, st := range in.HeroStats {
		heroes = append(heroes, st.Hero)
	}
	for _, sr := range in.SR {
		heroes = append(heroes, sr.Hero)
	}
	for _, h := range heroes {
		if h != "" && !parser.IsKnownHero(h) {
			return ErrUnknownHero
		}
	}
	return nil
}

func applyManualRank(data *db.UserMatchData, rank match.ManualRankInput) {
	if rank.Tier != "" {
		tier := rank.Tier
		data.Rank = &tier
	}
	division, progress, change := rank.Division, rank.Progress, rank.ChangePercent
	data.Level = &division
	data.RankProgress = &progress
	data.ChangePercent = &change
	if rank.DemotionProtection {
		data.Modifiers = append(data.Modifiers, "demotion protection")
	}
}

func userMatchDataFromInput(matchKey string, in match.UserMatchDataInput) db.UserMatchData {
	d := db.UserMatchData{
		MatchKey:      matchKey,
		Map:           in.Map,
		Hero:          in.Hero,
		Eliminations:  in.Eliminations,
		Assists:       in.Assists,
		Deaths:        in.Deaths,
		Damage:        in.Damage,
		Healing:       in.Healing,
		Mitigation:    in.Mitigation,
		Result:        in.Result,
		FinalScore:    in.FinalScore,
		Date:          in.Date,
		FinishedAt:    in.FinishedAt,
		GameLength:    in.GameLength,
		Rank:          in.Rank,
		Level:         in.Level,
		RankProgress:  in.RankProgress,
		ChangePercent: in.ChangePercent,
		Modifiers:     in.Modifiers,
	}
	for _, h := range in.Heroes {
		d.Heroes = append(d.Heroes, db.UserMatchHero{
			Hero:          h.Hero,
			PercentPlayed: h.PercentPlayed,
			PlayTime:      h.PlayTime,
			Position:      h.Position,
		})
	}
	for _, st := range in.HeroStats {
		d.HeroStats = append(d.HeroStats, db.UserMatchHeroStat{
			Hero: st.Hero, StatKey: st.StatKey, Value: st.Value,
		})
	}
	for _, sr := range in.SR {
		d.SR = append(d.SR, db.HeroSR{Hero: sr.Hero, SR: sr.SR, Change: sr.Change})
	}
	return d
}

// emitMatchByKey re-aggregates the single match and broadcasts it so connected
// clients refresh after an edit / reset. A no-op when the key no longer resolves
// (e.g. a manual match whose override row was just cleared).
func (a *App) emitMatchByKey(key string) {
	if rec, err := a.GetMatchByKey(key); err == nil {
		a.emitMatchUpdated(rec)
	}
}
