package app

import (
	"recall/pkg/parser"
)

// firstNonEmpty returns a when a is not its zero value; b otherwise.
// Used by mergeMatchResult for the "first non-empty wins" rule across
// the disjoint field sets SUMMARY / TEAMS / PERSONAL / RANK each
// populate.
func firstNonEmpty[T comparable](a, b T) T {
	var zero T
	if a != zero {
		return a
	}
	return b
}

func stringsConflict(a, b string) bool { return a != "" && b != "" && a != b }

func intsConflict(a, b int) bool { return a != 0 && b != 0 && a != b }

// mergeMatchResult fills empty fields on dst from src — each field takes
// the first non-zero / non-empty value seen across the merge group. This
// works because the four screenshot types populate disjoint subsets:
// SUMMARY has map/result/etc., TEAMS has damage/healing/mit, etc.
//
// Now invoked exclusively by the read-time aggregator (pkg/app/aggregate.go).
// The write path no longer merges — each parse writes its own typed row
// and folding happens on read.
func mergeMatchResult(dst, src *parser.MatchResult) {
	dst.Map = firstNonEmpty(dst.Map, src.Map)
	dst.MapRaw = firstNonEmpty(dst.MapRaw, src.MapRaw)
	dst.GameMode = firstNonEmpty(dst.GameMode, src.GameMode)
	dst.Playlist = firstNonEmpty(dst.Playlist, src.Playlist)
	dst.Role = firstNonEmpty(dst.Role, src.Role)
	dst.Hero = firstNonEmpty(dst.Hero, src.Hero)
	dst.HeroRaw = firstNonEmpty(dst.HeroRaw, src.HeroRaw)
	dst.Eliminations = firstNonEmpty(dst.Eliminations, src.Eliminations)
	dst.Assists = firstNonEmpty(dst.Assists, src.Assists)
	dst.Deaths = firstNonEmpty(dst.Deaths, src.Deaths)
	dst.Damage = firstNonEmpty(dst.Damage, src.Damage)
	dst.Healing = firstNonEmpty(dst.Healing, src.Healing)
	dst.Mitigation = firstNonEmpty(dst.Mitigation, src.Mitigation)
	dst.QueueType = firstNonEmpty(dst.QueueType, src.QueueType)
	dst.Result = firstNonEmpty(dst.Result, src.Result)
	dst.FinalScore = firstNonEmpty(dst.FinalScore, src.FinalScore)
	dst.Date = firstNonEmpty(dst.Date, src.Date)
	dst.FinishedAt = firstNonEmpty(dst.FinishedAt, src.FinishedAt)
	dst.GameLength = firstNonEmpty(dst.GameLength, src.GameLength)
	dst.Performance = firstNonEmpty(dst.Performance, src.Performance)
	dst.Rank = firstNonEmpty(dst.Rank, src.Rank)
	dst.Level = firstNonEmpty(dst.Level, src.Level)
	if len(dst.Modifiers) == 0 {
		dst.Modifiers = src.Modifiers
	}
	dst.RankProgress = firstNonEmpty(dst.RankProgress, src.RankProgress)
	dst.ChangePercent = firstNonEmpty(dst.ChangePercent, src.ChangePercent)
	for _, srcSR := range src.SR {
		exists := false
		for i := range dst.SR {
			if dst.SR[i].Hero == srcSR.Hero {
				exists = true
				if dst.SR[i].SR == 0 {
					dst.SR[i].SR = srcSR.SR
				}
				if dst.SR[i].Change == 0 {
					dst.SR[i].Change = srcSR.Change
				}
				break
			}
		}
		if !exists {
			dst.SR = append(dst.SR, srcSR)
		}
	}
	for _, srcHp := range src.HeroesPlayed {
		var match *parser.HeroPlay
		for i := range dst.HeroesPlayed {
			if dst.HeroesPlayed[i].Hero == srcHp.Hero {
				match = &dst.HeroesPlayed[i]
				break
			}
		}
		if match == nil {
			dst.HeroesPlayed = append(dst.HeroesPlayed, srcHp)
			continue
		}
		if match.PercentPlayed == 0 {
			match.PercentPlayed = srcHp.PercentPlayed
		}
		if match.PlayTime == "" {
			match.PlayTime = srcHp.PlayTime
		}
		for k, v := range srcHp.Stats {
			if match.Stats == nil {
				match.Stats = map[string]int{}
			}
			if _, exists := match.Stats[k]; !exists {
				match.Stats[k] = v
			}
		}
	}
}
