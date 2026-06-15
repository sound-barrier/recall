package app

import (
	"errors"
	"fmt"
	"time"

	"recall/pkg/db"
	"recall/pkg/match"
)

// validResults enumerates the three match outcomes. The empty string is not a
// valid override — omit the field to leave the OCR result untouched.
var validResults = map[string]bool{"victory": true, "defeat": true, "draw": true}

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

// buildManualMatch validates the manual form and converts it into a match_key +
// override row. Validation is light and roster-guided: the required identity
// fields plus enum membership, no cross-field rules.
func buildManualMatch(input match.ManualMatchInput) (string, db.UserMatchData, error) {
	switch {
	case input.Map == "":
		return "", db.UserMatchData{}, ErrManualNeedsMap
	case len(input.Heroes) == 0 || input.Heroes[0] == "":
		return "", db.UserMatchData{}, ErrManualNeedsHero
	case !validResults[input.Result]:
		return "", db.UserMatchData{}, ErrInvalidResult
	case !validPlayModes[input.PlayMode]:
		return "", db.UserMatchData{}, ErrInvalidPlayMode
	case !validQueueTypes[input.QueueType]:
		return "", db.UserMatchData{}, ErrInvalidQueueType
	case input.Leaver != "" && !validLeavers[input.Leaver]:
		return "", db.UserMatchData{}, ErrInvalidLeaver
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
