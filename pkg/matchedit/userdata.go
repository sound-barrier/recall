package matchedit

import (
	"errors"

	"recall/pkg/db"
	"recall/pkg/match"
	"recall/pkg/parser"
)

var (
	// ErrStatOutOfRange maps to 400 — an overridden numeric stat falls outside
	// the bounds api/openapi.yaml documents for the MatchResult response, which
	// the override layer echoes back verbatim.
	ErrStatOutOfRange = errors.New("invalid stat: a numeric value is out of range")
	// ErrDuplicateHeroPosition — two heroes claim one slot in the roster.
	// position 0 is the primary hero, so a tie there hands the choice to the
	// reader's sort tiebreak rather than to the player.
	ErrDuplicateHeroPosition = errors.New("invalid heroes: two heroes share one position")
)

// SetUserData replaces the user override set for a match (inline edits send
// the full current set; a per-field revert is the same call with that field
// omitted). The override layer is kept separate from the parsed OCR rows, so a
// later ResetUserData restores the original.
func SetUserData(s db.Store, matchKey string, in match.UserMatchDataInput) error {
	if matchKey == "" {
		return ErrMatchKeyRequired
	}
	if in.Result != nil && !validResults[*in.Result] {
		return ErrInvalidResult
	}
	if err := validateUserMatchData(in); err != nil {
		return err
	}
	// An override row on an unknown key does not annotate a match — it
	// SYNTHESIZES one (SynthesizeManualMatches), so a stray edit would
	// resurrect somebody else's match as a phantom in this history.
	if err := AssertMatchExists(s, matchKey); err != nil {
		return err
	}
	return s.UpsertUserMatchData(userMatchDataFromInput(matchKey, in))
}

// ResetUserData clears the user override set for a match — reverting an edited
// OCR match to pure OCR. (Deleting a hand-entered match is HardDelete, which
// also clears its queue / play-mode aux rows.) Idempotent.
func ResetUserData(s db.Store, matchKey string) error {
	if matchKey == "" {
		return ErrMatchKeyRequired
	}
	return s.DeleteUserMatchData(matchKey)
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
	if err := validateRosterFields(in); err != nil {
		return err
	}
	// Last: a roster naming a hero that does not exist is the more fundamental
	// complaint, and answering with the ordering instead would bury it.
	return validateHeroPositions(in)
}

// validateHeroPositions rejects a roster that puts two heroes in one slot.
// position is an ORDER — 0 is the primary hero, which drives the card header
// and the derived role — and the reader sorts on it alone, so a tie is settled
// by SQLite's tiebreak instead of by the player. The UI cannot send one (it
// assigns position from the list index); a non-UI client or a hand-edited
// bundle can. The store's UNIQUE (match_key, position) is the backstop; this
// is the answer the caller can read.
func validateHeroPositions(in match.UserMatchDataInput) error {
	seen := make(map[int]bool, len(in.Heroes))
	for _, h := range in.Heroes {
		if h.Hero == "" {
			continue // dropped by the writer, so it claims no slot
		}
		if seen[h.Position] {
			return ErrDuplicateHeroPosition
		}
		seen[h.Position] = true
	}
	return nil
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
	return validateSRRanges(in.SR)
}

// validateSRRanges is split out because Change became nullable — an omitted
// movement is unstated, not a stated zero — and the extra branch that took
// pushed validateNumericRanges past the complexity gate.
func validateSRRanges(rows []match.UserHeroSRInput) error {
	for _, sr := range rows {
		if !inRange(sr.SR, statMin, statMax) || !ptrInRange(sr.Change, changeMin, changeMax) {
			return ErrStatOutOfRange
		}
	}
	return nil
}

func validateRosterFields(in match.UserMatchDataInput) error {
	if in.Map != nil && *in.Map != "" && !parser.IsKnownMap(*in.Map) {
		return ErrUnknownMap
	}
	return validateKnownHeroes(overriddenHeroes(in))
}

// overriddenHeroes collects every hero name the override set references —
// the primary hero, the heroes-played list, stat cells, and SR rows.
func overriddenHeroes(in match.UserMatchDataInput) []string {
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
	return heroes
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
		PlayedAtUTC:   in.PlayedAtUTC,
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
