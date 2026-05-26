package parser

import (
	_ "embed"
	"fmt"
	"sort"
	"strings"
	"unicode"

	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
	"gopkg.in/yaml.v3"
)

// heroes.yaml + maps.yaml are the source of truth for the Overwatch
// hero / map roster. They land here (alongside the parser code that
// consumes them) so `//go:embed` can read them at compile time;
// neither file is intended to be edited by users, only by the
// maintainer when Blizzard ships a new hero or map.
//
// File shape:
//
//   # heroes.yaml
//   dps:     [Hero1, Hero2, …]
//   support: [Hero3, …]
//   tank:    [Hero4, …]
//
//   # maps.yaml
//   control:    [Map1, Map2, …]
//   escort:     [Map3, …]
//   flashpoint: [Map4, …]
//   hybrid:     [Map5, …]
//   push:       [Map6, …]
//   clash:      [Map7, …]
//
// Names in the YAML preserve their official Blizzard spelling +
// capitalization + diacritics ("Lúcio", "Soldier: 76", "Torbjörn",
// "Esperança"). The parser internally normalizes to lowercase ASCII
// (diacritics stripped) for OCR matching, since Tesseract reading
// the OW post-match font rarely produces accented characters
// correctly. Original strings are preserved in *DisplayName maps
// for UI surfaces that want the canonical form.

//go:embed heroes.yaml
var heroesYAML []byte

//go:embed maps.yaml
var mapsYAML []byte

//go:embed hero_stats.yaml
var heroStatsYAML []byte

// HeroesByRole / MapsByType expose the YAML structure as-is, with
// canonical-display names. UI consumers (via the /api/owdata
// endpoint) iterate these for ordered display.
var (
	HeroesByRole = map[string][]string{} // "dps" → ["Anran", "Ashe", …] (canonical)
	MapsByType   = map[string][]string{} // "control" → ["Antarctic Peninsula", …]
)

// Internal lookup tables — keyed by the lowercase-ASCII normalized form
// the parser uses for OCR matching.
var (
	heroRoles        = map[string]string{}   // "lúcio"→"lucio" key → "support"
	mapTypes         = map[string]string{}   // "lijiang tower" → "control"
	heroDisplayNames = map[string]string{}   // "lucio" → "Lúcio"
	mapDisplayNames  = map[string]string{}   // "lijiang tower" → "Lijiang Tower"
	knownMaps        []string                // sorted-by-length-desc normalized map names
	heroStatKeys     = map[string][]string{} // "juno" → ["damage_amplified", "orbital_ray_assists", …]
)

// normalize derives the OCR-matching key from a YAML canonical name:
//
//  1. Lower-case.
//  2. Strip combining diacritics ("Lúcio" → "lucio", "Esperança" →
//     "esperanca", "Torbjörn" → "torbjorn", "Paraíso" → "paraiso").
//     Tesseract reading OW's post-match font rarely produces
//     accented characters correctly, so the lookup table is
//     diacritic-free.
//  3. Strip colons ("Soldier: 76" → "soldier 76", "Watchpoint:
//     Gibraltar" → "watchpoint gibraltar"). OW renders colons in
//     two name strings; Tesseract sometimes preserves them and
//     sometimes drops them. Folding both forms to one lookup key
//     handles either OCR output.
//  4. Collapse runs of whitespace introduced by the colon strip.
//
// Idempotent — calling on an already-normalized string is a no-op.
func normalize(s string) string {
	t := transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC)
	out, _, err := transform.String(t, s)
	if err != nil {
		out = s // best-effort fall-through
	}
	out = strings.ToLower(out)
	out = strings.ReplaceAll(out, ":", "")
	out = strings.Join(strings.Fields(out), " ")
	return out
}

func init() {
	heroesRaw := map[string][]string{}
	if err := yaml.Unmarshal(heroesYAML, &heroesRaw); err != nil {
		panic(fmt.Sprintf("parser: heroes.yaml parse: %v", err))
	}
	for role, list := range heroesRaw {
		// Stable display order — Blizzard's release-order alphabetisation
		// per-role makes scanning predictable for users.
		sorted := append([]string(nil), list...)
		sort.Strings(sorted)
		HeroesByRole[role] = sorted
		for _, name := range list {
			key := normalize(name)
			heroRoles[key] = role
			heroDisplayNames[key] = name
		}
	}

	mapsRaw := map[string][]string{}
	if err := yaml.Unmarshal(mapsYAML, &mapsRaw); err != nil {
		panic(fmt.Sprintf("parser: maps.yaml parse: %v", err))
	}
	for typ, list := range mapsRaw {
		sorted := append([]string(nil), list...)
		sort.Strings(sorted)
		MapsByType[typ] = sorted
		for _, name := range list {
			key := normalize(name)
			mapTypes[key] = typ
			mapDisplayNames[key] = name
			knownMaps = append(knownMaps, key)
		}
	}
	sort.Strings(knownMaps) // stable iteration in tests + Levenshtein scan

	statsRaw := map[string][]string{}
	if err := yaml.Unmarshal(heroStatsYAML, &statsRaw); err != nil {
		panic(fmt.Sprintf("parser: hero_stats.yaml parse: %v", err))
	}
	for hero, keys := range statsRaw {
		sorted := append([]string(nil), keys...)
		sort.Strings(sorted)
		heroStatKeys[normalize(hero)] = sorted
	}
}

// SnapHeroStatKey returns the canonical stat-key for `hero` that's
// closest (by Levenshtein distance) to the OCR-derived `rawKey`. If
// there's no canonical list for `hero` (unknown hero, or one not yet
// seeded in hero_stats.yaml), or no canonical is within ~40% edit
// distance of the raw key, returns `rawKey` unchanged.
//
// Used by parse_personal.go + parse_scoreboard.go to clean up
// stat-name OCR mangling (Juno's "ORBITAL RAY ASSISTS" landing as
// `ooorsitall_ray_assists`, Mizuki's "PLAYERS SAVED" as
// `player_saved`). Threshold mirrors snapToKnownMap in maps.go.
func SnapHeroStatKey(hero, rawKey string) string {
	canonicals, ok := heroStatKeys[normalize(hero)]
	if !ok || rawKey == "" {
		return rawKey
	}
	best := rawKey
	bestDist := -1
	for _, c := range canonicals {
		if c == rawKey {
			return c // exact match — no further search needed
		}
		d := levenshtein(rawKey, c)
		threshold := len(c) * 4 / 10
		if d <= threshold && (bestDist < 0 || d < bestDist) {
			bestDist = d
			best = c
		}
	}
	return best
}

// Note: HeroDisplayName / MapDisplayName / MapType wrappers around
// the unexported lookup maps were intentionally NOT added at the Go
// layer — the frontend reaches the same data via /api/owdata and
// applies its own normalization there (see
// frontend/src/composables/useOWData.ts). If a future Go-side caller
// (e.g. metrics labels, server-mode templating) needs canonical
// names, drop a 1-line wrapper here that delegates to
// `heroDisplayNames[normalize(input)]` / `mapDisplayNames[…]` /
// `mapTypes[…]`.
