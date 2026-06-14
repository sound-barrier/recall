package correlate

import (
	"recall/pkg/parser"
)

// FirstNonEmpty returns a when a is not its zero value; b otherwise.
// Used by MergeMatchResult for the "first non-empty wins" rule across
// the disjoint field sets SUMMARY / TEAMS / PERSONAL / RANK each
// populate.
func FirstNonEmpty[T comparable](a, b T) T {
	var zero T
	if a != zero {
		return a
	}
	return b
}

func StringsConflict(a, b string) bool { return a != "" && b != "" && a != b }

func IntsConflict(a, b int) bool { return a != 0 && b != 0 && a != b }

// MergeMatchResult fills empty fields on dst from src — each field takes
// the first non-zero / non-empty value seen across the merge group. This
// works because the four screenshot types populate disjoint subsets:
// SUMMARY has map/result/etc., TEAMS has damage/healing/mit, etc.
//
// Now invoked exclusively by the read-time aggregator (pkg/app/aggregate.go).
// The write path no longer merges — each parse writes its own typed row
// and folding happens on read.
func MergeMatchResult(dst, src *parser.MatchResult) {
	dst.Map = FirstNonEmpty(dst.Map, src.Map)
	dst.MapRaw = FirstNonEmpty(dst.MapRaw, src.MapRaw)
	dst.GameMode = FirstNonEmpty(dst.GameMode, src.GameMode)
	dst.Playlist = FirstNonEmpty(dst.Playlist, src.Playlist)
	dst.Role = FirstNonEmpty(dst.Role, src.Role)
	dst.Hero = FirstNonEmpty(dst.Hero, src.Hero)
	dst.HeroRaw = FirstNonEmpty(dst.HeroRaw, src.HeroRaw)
	dst.Eliminations = FirstNonEmpty(dst.Eliminations, src.Eliminations)
	dst.Assists = FirstNonEmpty(dst.Assists, src.Assists)
	dst.Deaths = FirstNonEmpty(dst.Deaths, src.Deaths)
	dst.Damage = FirstNonEmpty(dst.Damage, src.Damage)
	dst.Healing = FirstNonEmpty(dst.Healing, src.Healing)
	dst.Mitigation = FirstNonEmpty(dst.Mitigation, src.Mitigation)
	dst.QueueType = FirstNonEmpty(dst.QueueType, src.QueueType)
	dst.Result = FirstNonEmpty(dst.Result, src.Result)
	dst.FinalScore = FirstNonEmpty(dst.FinalScore, src.FinalScore)
	dst.Date = FirstNonEmpty(dst.Date, src.Date)
	dst.FinishedAt = FirstNonEmpty(dst.FinishedAt, src.FinishedAt)
	dst.GameLength = FirstNonEmpty(dst.GameLength, src.GameLength)
	dst.Performance = FirstNonEmpty(dst.Performance, src.Performance)
	dst.Rank = FirstNonEmpty(dst.Rank, src.Rank)
	dst.Level = FirstNonEmpty(dst.Level, src.Level)
	if len(dst.Modifiers) == 0 {
		dst.Modifiers = src.Modifiers
	}
	dst.RankProgress = FirstNonEmpty(dst.RankProgress, src.RankProgress)
	dst.ChangePercent = FirstNonEmpty(dst.ChangePercent, src.ChangePercent)
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
