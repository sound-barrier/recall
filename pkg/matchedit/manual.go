package matchedit

import (
	"errors"
	"fmt"
	"time"

	"recall/pkg/db"
	"recall/pkg/match"
	"recall/pkg/parser"
)

var (
	// ErrManualNeedsMap maps to 400 — a manual match must name its map.
	ErrManualNeedsMap = errors.New("map is required")
	// ErrMatchKeyExists maps to 409 — a match already exists at that time.
	ErrMatchKeyExists = errors.New("a match already exists for that time; pick a different minute")
	// ErrInvalidPlayedAt maps to 400 — played_at wasn't valid RFC 3339.
	ErrInvalidPlayedAt = errors.New("invalid played_at: must be RFC 3339")
	// ErrInvalidRank maps to 400 — a manual rank value falls outside the bounds
	// the MatchResult response promises (level 0-5, rank_progress 0-100,
	// change_percent ±1_000_000). The create path echoes these straight back, so
	// an out-of-range input would emit a schema-violating response.
	ErrInvalidRank = errors.New("invalid rank: division, progress, or change_percent out of range")
	// ErrUnknownRank maps to 409 — the tier isn't on the competitive ladder.
	// Maps and heroes have been guarded since they were introduced; the tier
	// never was, so a manual match could store "Platinum" (or anything at all)
	// and only fail much later and silently, when the frontend could not place
	// it on the ladder and dropped it from every rank chart.
	ErrUnknownRank = errors.New("unknown rank: not on the competitive ladder")
)

// CreateManual hand-enters a match for users without OCR. It derives the
// match_key from PlayedAt (default now), rejects a collision with any existing
// match (so the user picks a different minute), and writes the override row plus
// the queue / play-mode aux rows. It returns the minted key rather than a
// record: aggregating one is the caller's job, above this layer.
func CreateManual(s db.Store, in match.ManualMatchInput) (string, error) {
	key, data, err := buildManualMatch(in)
	if err != nil {
		return "", err
	}
	exists, err := s.MatchKeyExists(key)
	if err != nil {
		return "", err
	}
	if exists {
		return "", ErrMatchKeyExists
	}
	if err := s.UpsertUserMatchData(data); err != nil {
		return "", err
	}
	if err := writeManualAuxRows(s, key, in); err != nil {
		return "", err
	}
	return key, nil
}

// writeManualAuxRows persists a manual match's optional side rows. Both aux
// rows are skipped when omitted — a quick-add knows the map and the outcome,
// not how the game was queued, and writing "" would claim it did. The
// detail-panel choosers can set them later.
func writeManualAuxRows(s db.Store, key string, in match.ManualMatchInput) error {
	if in.PlayMode != "" {
		if err := s.SetMatchPlayMode(key, in.PlayMode); err != nil {
			return err
		}
	}
	if in.QueueType != "" {
		if err := s.SetMatchQueue(key, in.QueueType); err != nil {
			return err
		}
	}
	// Disruption sides + the optional annotation fields (replay code / note /
	// tags / the squad they grouped with) all ride the existing annotation
	// surface in one upsert — the same row the detail-panel choosers edit later.
	//
	// The skip decision reads the NORMALIZED annotation, never the raw form.
	// Testing the raw fields let anything that vanishes under trimming — an
	// empty tag chip, a whitespace-only note, a blank leaver — pass this gate
	// and then trip SetAnnotation's emptiness check, by which point
	// UpsertUserMatchData had already committed the match. The caller got a
	// 500 carrying no match_key while the match itself showed up on the next
	// reload, so it could not undo what it did not know it had made.
	//
	// Treating it as OMITTED rather than rejecting it is this file's own
	// doctrine ("only omission is free") and matches what normalizeSides
	// already does with an all-blank leaver list.
	ann := manualAnnotationInput(key, in)
	norm, err := normalizeAnnotation(ann)
	if err != nil {
		return err
	}
	if annotationIsEmpty(norm) {
		return nil
	}
	return SetAnnotation(s, ann)
}

// manualAnnotationInput projects the manual form onto the annotation surface.
func manualAnnotationInput(key string, in match.ManualMatchInput) AnnotationInput {
	return AnnotationInput{
		MatchKey:   key,
		Leavers:    in.Leavers,
		Throwers:   in.Throwers,
		ReplayCode: in.ReplayCode,
		Note:       in.Note,
		Tags:       in.Tags,
		Members:    in.Members,
	}
}

// validateManualMatchInput checks the manual form's required identity fields,
// enum membership, rank ranges, and map/hero roster membership.
//
// Only map and result are required. Hero, play mode, and queue type are
// optional because the leaver-exit quick-add records a match the game erased
// from history, where the user knows the map and the outcome and nothing else —
// inventing a hero or a queue there would be fabricating data. A value that IS
// supplied still has to be valid; only omission is free.
func validateManualMatchInput(in match.ManualMatchInput) error {
	if err := validateManualIdentity(in); err != nil {
		return err
	}
	if err := ValidateDisruptionSides(in.Leavers, in.Throwers); err != nil {
		return err
	}
	// Checked here rather than where it is written: the match row goes in
	// before the annotation does, so a code refused downstream would leave a
	// half-created match holding the key the user would need to retry with.
	if _, err := normalizeReplayCode(in.ReplayCode); err != nil {
		return err
	}
	if in.Rank != nil {
		if err := validateManualRank(*in.Rank); err != nil {
			return err
		}
	}
	return validateManualRoster(in)
}

// validateManualIdentity checks the manual form's required identity fields
// and enum membership.
func validateManualIdentity(in match.ManualMatchInput) error {
	switch {
	case in.Map == "":
		return ErrManualNeedsMap
	case !validResults[in.Result]:
		return ErrInvalidResult
	case in.PlayMode != "" && !IsValidPlayMode(in.PlayMode):
		return ErrInvalidPlayMode
	case in.QueueType != "" && !IsValidQueueType(in.QueueType):
		return ErrInvalidQueueType
	}
	return nil
}

// validateManualRoster checks map / hero roster membership.
func validateManualRoster(in match.ManualMatchInput) error {
	if !parser.IsKnownMap(in.Map) {
		return ErrUnknownMap
	}
	return validateKnownHeroes(in.Heroes)
}

// buildManualMatch validates the manual form and converts it into a match_key +
// override row.
func buildManualMatch(in match.ManualMatchInput) (string, db.UserMatchData, error) {
	if err := validateManualMatchInput(in); err != nil {
		return "", db.UserMatchData{}, err
	}

	// The wall clock in played_at's STATED offset drives the key, date,
	// and finished_at — never a UTC conversion. OCR rows store the
	// player's local wall clock (filename timestamps + the SUMMARY's
	// on-screen clock), so manual rows must sit on the same naive-local
	// axis or every time-based sort/filter is hours off for them.
	played := time.Now()
	if in.PlayedAt != "" {
		parsed, err := time.Parse(time.RFC3339, in.PlayedAt)
		if err != nil {
			return "", db.UserMatchData{}, fmt.Errorf("%w (%w)", ErrInvalidPlayedAt, err)
		}
		played = parsed
	}
	key := match.NewTrackedMatchKey(played.Format("2006-01-02T15-04-05")).String()

	mapName, result := in.Map, in.Result
	// A quick-add carries no hero at all; keep the column NULL rather than
	// writing an empty override, so the record reads as "not recorded".
	var primary *string
	if len(in.Heroes) > 0 && in.Heroes[0] != "" {
		hero := in.Heroes[0]
		primary = &hero
	}
	// Naive local wall-clock for date/finished_at/key (axis consistency with
	// OCR rows); canonical UTC is exact because played carries the wire offset.
	date, finished := played.Format("2006-01-02"), played.Format("15:04")
	playedUTC := played.UTC().Format(time.RFC3339)
	data := db.UserMatchData{
		MatchKey:    key,
		Map:         &mapName,
		Hero:        primary,
		Result:      &result,
		Date:        &date,
		FinishedAt:  &finished,
		PlayedAtUTC: &playedUTC,
	}
	for i, h := range in.Heroes {
		if h != "" {
			data.Heroes = append(data.Heroes, db.UserMatchHero{Hero: h, Position: i})
		}
	}
	if in.Rank != nil {
		applyManualRank(&data, *in.Rank)
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
	// An empty tier means "no rank on this match", which is legal; anything
	// else has to be a real tier, matched against the same ladder the parser
	// and the charts use.
	if rank.Tier != "" && !parser.IsKnownRank(rank.Tier) {
		return ErrUnknownRank
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
