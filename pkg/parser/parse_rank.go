package parser

import (
	"image"
	"regexp"
	"strconv"
	"strings"
)

// knownRanks is the OW competitive tier list, used to snap OCR'd tier text.
var knownRanks = []string{
	"bronze", "silver", "gold", "platinum", "diamond",
	"master", "grandmaster", "champion",
}

// knownModifiers is the OW competitive match-outcome modifier list. These
// label the small pills under the rank progress bar.
var knownModifiers = []string{
	"expected", "unexpected", "underdog", "overcharge",
	"victory", "defeat", "draw",
}

// isRankScreenshot detects the post-match competitive RANK PROGRESS screen.
// "RANK PROGRESS" sits in the middle of the screen and is unique to this
// view (SUMMARY / TEAMS / PERSONAL never show it).
func isRankScreenshot(img image.Image, work string) bool {
	bounds := img.Bounds()
	W, H := bounds.Dx(), bounds.Dy()
	rect := image.Rect(W*10/100, H*55/100, W*70/100, H*78/100)
	text, err := ocrInverted(img, rect, work, "detect_rank", "11", "")
	if err != nil {
		return false
	}
	return strings.Contains(strings.ToUpper(text), "RANK PROGRESS")
}

// parseRank handles the post-match competitive rank screen: the tier badge
// (PLATINUM 5), the rank-progress bar with its change percentage, the match
// modifier pills (EXPECTED / VICTORY / etc.), and the per-hero SR + delta
// panel on the right. mode is forced to "competitive" because this screen
// only shows up for ranked play.
func parseRank(img image.Image, work string) (*MatchResult, error) {
	bounds := img.Bounds()
	W, H := bounds.Dx(), bounds.Dy()
	res := &MatchResult{Playlist: "competitive"}

	// Top-left banner: "COMPETITIVE VICTORY!" / "COMPETITIVE DEFEAT!" /
	// "COMPETITIVE DRAW!". Same prefix-match rule as the SUMMARY card so
	// OCR slips like "DEFERT" still classify.
	bannerRect := image.Rect(0, H*7/100, W*45/100, H*22/100)
	bannerText, _ := ocrInverted(img, bannerRect, work, "rank_banner", "11", "")
	upper := strings.ToUpper(bannerText)
	switch {
	case strings.Contains(upper, "VICTOR"):
		res.Result = "victory"
	case strings.Contains(upper, "DEFE"):
		res.Result = "defeat"
	case strings.Contains(upper, "DRAW") || strings.Contains(upper, "DRAU"):
		res.Result = "draw"
	}

	// Tier label: "PLATINUM 5" text sits just below the badge in the center
	// (Y≈60-68% of H — the badge itself takes the band above it).
	tierRect := image.Rect(W*30/100, H*58/100, W*70/100, H*70/100)
	tierText, _ := ocrInverted(img, tierRect, work, "rank_tier", "11", "")
	res.Rank, res.Level = extractRank(tierText)

	// Rank progress bar — "RANK PROGRESS: 21%" caption plus a "+25%" delta
	// pill inside the bar. OCR both in one wider crop and pull each via its
	// own regex.
	progressRect := image.Rect(W*10/100, H*60/100, W*70/100, H*80/100)
	progressText, _ := ocrInverted(img, progressRect, work, "rank_progress", "11", "")
	if m := regexp.MustCompile(`(?i)RANK\s*PROGRESS[^0-9]*(\d{1,3})`).FindStringSubmatch(progressText); m != nil {
		res.RankProgress, _ = strconv.Atoi(m[1])
	}
	if m := regexp.MustCompile(`\+\s*(\d{1,3})\s*%`).FindStringSubmatch(progressText); m != nil {
		res.ChangePercent, _ = strconv.Atoi(m[1])
	}

	// Modifier pills below the progress bar.
	modifierRect := image.Rect(W*10/100, H*78/100, W*55/100, H*90/100)
	modifierText, _ := ocrInverted(img, modifierRect, work, "rank_modifiers", "11", "")
	res.Modifiers = extractModifiers(modifierText)

	// Right-side per-hero SR card: hero portrait + "HERO SR" + 4-digit SR +
	// signed change. The card sits ~85-99% across, mid-height.
	srRect := image.Rect(W*82/100, H*22/100, W*99/100, H*55/100)
	srText, _ := ocrInverted(img, srRect, work, "rank_sr", "11", "")
	res.SR = extractSR(srText)
	if len(res.SR) > 0 {
		res.Hero = res.SR[0].Hero
		if r, ok := loadDataset().heroRoles[res.Hero]; ok {
			res.Role = r
		}
	}

	return res, nil
}

func extractRank(text string) (string, int) {
	lower := strings.ToLower(text)
	rank := ""
	for _, r := range knownRanks {
		if strings.Contains(lower, r) {
			rank = r
			break
		}
	}
	level := 0
	// Anchor the level match on the rank name to avoid picking up unrelated
	// digits from icon noise (e.g. Tesseract reads italic decoration as
	// extra digits before the level). Take the LAST digit in the trailing
	// number-run after the rank — italic fonts often misread to insert a
	// leading digit (so "PLATINUM 5" OCRs as "PLATINUM 35"), and OW levels
	// are always 1-5 single digits.
	if rank != "" {
		re := regexp.MustCompile(`(?i)` + rank + `\s*(\d+)`)
		if m := re.FindStringSubmatch(text); m != nil {
			lastDigit := m[1][len(m[1])-1:]
			level, _ = strconv.Atoi(lastDigit)
		}
	}
	return rank, level
}

func extractModifiers(text string) []string {
	lower := strings.ToLower(text)
	seen := map[string]bool{}
	var found []string
	for _, m := range knownModifiers {
		if strings.Contains(lower, m) && !seen[m] {
			found = append(found, m)
			seen[m] = true
		}
	}
	return found
}

// extractSR pulls (hero, SR, change) from the right-side SR panel OCR. SR is
// the first 4-digit integer; change is the first 1-3 digit integer (with
// optional sign) after the SR. Heroes use the existing extractHeroes fuzzy
// matcher.
func extractSR(text string) []HeroSR {
	heroes := extractHeroes(text)
	if len(heroes) == 0 {
		return nil
	}
	out := make([]HeroSR, 0, len(heroes))
	for _, h := range heroes {
		entry := HeroSR{Hero: h}
		if m := regexp.MustCompile(`\b(\d{4})\b`).FindStringSubmatchIndex(text); m != nil {
			entry.SR, _ = strconv.Atoi(text[m[2]:m[3]])
			rest := text[m[1]:]
			if m2 := regexp.MustCompile(`([+\-]?)\s*(\d{1,3})`).FindStringSubmatch(rest); m2 != nil {
				v, _ := strconv.Atoi(m2[2])
				if m2[1] == "-" {
					v = -v
				}
				entry.Change = v
			}
		}
		out = append(out, entry)
	}
	return out
}
