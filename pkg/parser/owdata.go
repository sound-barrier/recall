package parser

import (
	_ "embed"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync/atomic"
	"unicode"

	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
	"gopkg.in/yaml.v3"
)

// heroes.yaml + maps.yaml are the canonical Overwatch hero / map
// roster. screenshot_sources.yaml lists the per-capture-tool filename
// grammars parseFilenameTimestamp walks. hero_stats.yaml carries the
// per-hero stat-key list used by SnapHeroStatKey to fix OCR mangling.
//
// All four ship `//go:embed`'d into the binary as the default. At
// startup (and on every Reload), the parser also checks
// <parserDataDirFunc()>/<name>.yaml for a user-supplied override; if
// present + parseable it takes priority, otherwise the embedded bytes
// are used. Apply-update fills that user directory with a freshly-
// fetched, SHA-256-verified copy from the latest release so a new
// hero/map/capture-tool grammar can ship without a binary rebuild.
//
// File shape (heroes.yaml):
//
//	dps:     [Hero1, Hero2, …]
//	support: [Hero3, …]
//	tank:    [Hero4, …]
//
// File shape (maps.yaml):
//
//	control:    [Map1, Map2, …]
//	escort:     [Map3, …]
//	flashpoint: [Map4, …]
//	hybrid:     [Map5, …]
//	push:       [Map6, …]
//	clash:      [Map7, …]
//
// Names in the YAML preserve their official Blizzard spelling +
// capitalization + diacritics ("Lúcio", "Soldier: 76", "Torbjörn",
// "Esperança"). The parser internally normalizes to lowercase ASCII
// (diacritics stripped) for OCR matching, since Tesseract reading
// the OW post-match font rarely produces accented characters
// correctly. Original strings are preserved in *DisplayName maps
// for UI surfaces that want the canonical form.

//go:embed heroes.yaml
var embeddedHeroesYAML []byte

//go:embed maps.yaml
var embeddedMapsYAML []byte

//go:embed hero_stats.yaml
var embeddedHeroStatsYAML []byte

//go:embed screenshot_sources.yaml
var embeddedScreenshotSourcesYAML []byte

// owDataset bundles every parser lookup into one immutable snapshot.
// Reload() builds a fresh *owDataset and atomic-Pointer-Stores it;
// readers call loadDataset() once per call site and read fields off
// the returned pointer. No locks needed because the snapshot is
// never mutated after publication; a mid-call Reload only affects
// future loadDataset() calls.
type owDataset struct {
	// Canonical display-name lists (sorted alphabetically per group)
	// for UI surfaces.
	heroesByRole map[string][]string // "dps" → ["Anran", "Ashe", …]
	mapsByType   map[string][]string // "control" → ["Antarctic Peninsula", …]

	// OCR-matching lookup tables, keyed by the lowercase-ASCII
	// normalized form (see normalize()).
	heroRoles        map[string]string   // "lucio" → "support"
	mapTypes         map[string]string   // "lijiang tower" → "control"
	heroDisplayNames map[string]string   // "lucio" → "Lúcio"
	mapDisplayNames  map[string]string   // "lijiang tower" → "Lijiang Tower"
	knownMaps        []string            // sorted-asc normalized map names
	heroStatKeys     map[string][]string // "juno" → ["damage_amplified", …]

	// Screenshot-source filename grammars.
	screenshotSources []ScreenshotSource

	// Combined load error from this snapshot's construction. nil
	// means every YAML loaded cleanly; non-nil means at least one
	// fell back (or fell through to empty if even the embedded
	// failed). Surfaced via LoadError() for the UI banner.
	loadErr error
}

// dataset holds the currently-published *owDataset. atomic.Pointer
// gives lock-free Load + atomic Store; readers see either the old or
// new snapshot, never a partial mix.
var dataset atomic.Pointer[owDataset]

// parserDataDirFunc returns the directory holding user-supplied
// override YAML files, or "" for "embedded only". Production wires
// this from pkg/app/parser_dir.go to point at <RECALL_DATA_DIR>/data.
// Tests swap directly via the swapDataDir helper in
// owdata_reload_test.go. Pattern matches releasesURL in update.go
// per CLAUDE.md's function-variable-seam guidance.
var parserDataDirFunc = func() string { return "" }

// SetDataDirFunc is the production-side entry point for wiring the
// user override directory. The function is invoked on every Reload —
// callers that need the directory to track an env var (e.g. tests
// using t.Setenv("RECALL_DATA_DIR", ...) after pkg/app's init has
// already captured the base dir) should pass a closure that re-reads
// the env var each call. Pass `func() string { return "" }` to
// disable user overrides entirely.
func SetDataDirFunc(f func() string) {
	parserDataDirFunc = f
}

// loadDataset returns the current published dataset. Cheap (one
// atomic load). Hot-path callers should snapshot once and read fields
// off the result to keep all reads consistent within a single OCR
// pass.
func loadDataset() *owDataset {
	return dataset.Load()
}

// HeroesByRole returns the canonical-display hero roster grouped by
// role. The returned map is owned by the current dataset and must
// not be mutated by callers.
func HeroesByRole() map[string][]string { return loadDataset().heroesByRole }

// MapsByType returns the canonical-display map roster grouped by
// game type. The returned map is owned by the current dataset and
// must not be mutated by callers.
func MapsByType() map[string][]string { return loadDataset().mapsByType }

// Sources returns the screenshot-source filename grammars. The
// returned slice is owned by the current dataset and must not be
// mutated by callers.
func Sources() []ScreenshotSource { return loadDataset().screenshotSources }

// LoadError returns the combined error from the current dataset's
// construction, or nil if every YAML loaded cleanly. Surfaced via
// /api/v1/system/reference-data so the UI can render a banner if a
// user-override file is corrupt and the parser fell back to embedded.
func LoadError() error { return loadDataset().loadErr }

// init triggers the first Reload so subsequent package-level reads
// see a populated dataset even before SetDataDir is called from
// pkg/app's init. With parserDataDirFunc defaulting to "", this loads
// the embedded YAML — same behaviour as the pre-refactor init().
//
// Embedded YAML failures used to `panic` here, which crashed the
// process during the init phase — on a desktop build that shows as
// a window flash with no error reporting. Switched to graceful: log
// the error, store it on the dataset for the UI to surface, and
// leave the affected registry empty (heroes show as "unknown role"
// rather than the binary refusing to start). The build-time test in
// owdata_test.go::TestEmbeddedYAML_LoadsCleanly is the gate that
// keeps a bad embedded YAML from shipping in the first place.
func init() {
	if err := Reload(); err != nil {
		log.Printf("parser: initial reload returned errors: %v", err)
	}
}

// Reload rebuilds the parser dataset from disk + embedded fallback
// and atomically publishes the new snapshot. Safe to call while
// readers are active — atomic.Pointer.Store guarantees a coherent
// transition.
//
// The returned error reports any per-file load failures (joined).
// Even on error, a dataset is always published — readers continue
// to see the embedded data so a corrupt user file can't brick the
// parser.
func Reload() error {
	ds := &owDataset{
		heroesByRole:     map[string][]string{},
		mapsByType:       map[string][]string{},
		heroRoles:        map[string]string{},
		mapTypes:         map[string]string{},
		heroDisplayNames: map[string]string{},
		mapDisplayNames:  map[string]string{},
		heroStatKeys:     map[string][]string{},
	}

	var errs []error
	if err := loadInto(ds, "heroes.yaml", embeddedHeroesYAML, unmarshalHeroes); err != nil {
		errs = append(errs, err)
	}
	if err := loadInto(ds, "maps.yaml", embeddedMapsYAML, unmarshalMaps); err != nil {
		errs = append(errs, err)
	}
	if err := loadInto(ds, "hero_stats.yaml", embeddedHeroStatsYAML, unmarshalHeroStats); err != nil {
		errs = append(errs, err)
	}
	if err := loadInto(ds, "screenshot_sources.yaml", embeddedScreenshotSourcesYAML, unmarshalScreenshotSources); err != nil {
		errs = append(errs, err)
	}

	ds.loadErr = errors.Join(errs...)
	dataset.Store(ds)
	return ds.loadErr
}

// loadInto tries the user override first; on miss or parse failure
// falls back to embedded. Either path that errors is reported, but
// the dataset is still populated with whichever bytes succeeded.
func loadInto(ds *owDataset, name string, embedded []byte, fn func(*owDataset, []byte) error) error {
	if user := tryUserBytes(name); user != nil {
		if err := fn(ds, user); err == nil {
			return nil
		} else {
			// User file failed parse — fall back to embedded but
			// surface the user-side error so the UI can flag it.
			if errEmb := fn(ds, embedded); errEmb != nil {
				return fmt.Errorf("%s: user file invalid (%v) and embedded fallback also failed: %w", name, err, errEmb)
			}
			return fmt.Errorf("%s: user file invalid, fell back to embedded: %w", name, err)
		}
	}
	if err := fn(ds, embedded); err != nil {
		return fmt.Errorf("%s (embedded): %w", name, err)
	}
	return nil
}

// tryUserBytes returns the user override file bytes for `name` under
// the configured data directory, or nil if none configured / file
// missing / unreadable.
func tryUserBytes(name string) []byte {
	dir := parserDataDirFunc()
	if dir == "" {
		return nil
	}
	b, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil {
		return nil
	}
	return b
}

func unmarshalHeroes(ds *owDataset, bytes []byte) error {
	heroesRaw := map[string][]string{}
	if err := yaml.Unmarshal(bytes, &heroesRaw); err != nil {
		return err
	}
	for role, list := range heroesRaw {
		sorted := append([]string(nil), list...)
		sort.Strings(sorted)
		ds.heroesByRole[role] = sorted
		for _, name := range list {
			key := normalize(name)
			ds.heroRoles[key] = role
			ds.heroDisplayNames[key] = name
		}
	}
	return nil
}

func unmarshalMaps(ds *owDataset, bytes []byte) error {
	mapsRaw := map[string][]string{}
	if err := yaml.Unmarshal(bytes, &mapsRaw); err != nil {
		return err
	}
	for typ, list := range mapsRaw {
		sorted := append([]string(nil), list...)
		sort.Strings(sorted)
		ds.mapsByType[typ] = sorted
		for _, name := range list {
			key := normalize(name)
			ds.mapTypes[key] = typ
			ds.mapDisplayNames[key] = name
			ds.knownMaps = append(ds.knownMaps, key)
		}
	}
	sort.Strings(ds.knownMaps)
	return nil
}

func unmarshalHeroStats(ds *owDataset, bytes []byte) error {
	statsRaw := map[string][]string{}
	if err := yaml.Unmarshal(bytes, &statsRaw); err != nil {
		return err
	}
	for hero, keys := range statsRaw {
		sorted := append([]string(nil), keys...)
		sort.Strings(sorted)
		ds.heroStatKeys[normalize(hero)] = sorted
	}
	return nil
}

// normalize derives the OCR-matching key from a YAML canonical name:
//
//  1. Lower-case.
//  2. Strip combining diacritics ("Lúcio" → "lucio", "Esperança" →
//     "esperanca", "Torbjörn" → "torbjorn", "Paraíso" → "paraiso").
//  3. Strip colons ("Soldier: 76" → "soldier 76", "Watchpoint:
//     Gibraltar" → "watchpoint gibraltar").
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

// Normalize exposes the parser's internal hero/map name normalization
// for downstream callers that need to match the form `data.hero` /
// `data.map` are stored in. Dev-seed fixtures use this to convert
// canonical YAML names ("Lúcio", "Soldier: 76", "D.Va") into the
// stored keys ("lucio", "soldier 76", "dva") so seeded matches behave
// identically to real parsed data through the aggregator and the
// frontend's `useOWData.heroDisplayName(stored)` lookup.
func Normalize(s string) string { return normalize(s) }

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
	ds := loadDataset()
	canonicals, ok := ds.heroStatKeys[normalize(hero)]
	if !ok || rawKey == "" {
		return rawKey
	}
	best := rawKey
	bestDist := -1
	for _, c := range canonicals {
		if c == rawKey {
			return c
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
