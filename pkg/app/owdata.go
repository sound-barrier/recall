package app

import (
	"time"

	"recall/pkg/parser"
)

// OWData is the read-only Overwatch reference data the parser is keyed
// against — the canonical hero roster (per role) and map roster (per
// game type). The bytes ultimately come from `pkg/parser/heroes.yaml`
// and `pkg/parser/maps.yaml`, embedded at compile time. Surfaced to
// the frontend via the /api/v1/system/reference-data HTTP route + the Wails-bound
// `App.GetOWData` so the UI can render canonical names (with diacritic
// + capitalization preserved) and group heroes by role / maps by type
// without re-shipping the same lists in TypeScript.
type OWData struct {
	HeroesByRole      map[string][]string `json:"heroes_by_role"`
	MapsByGameMode    map[string][]string `json:"maps_by_game_mode"`
	ScreenshotSources []ScreenshotSource  `json:"screenshot_sources"`
	Seasons           []Season            `json:"seasons"`
	// Ranks is the competitive tier ladder, LOWEST to HIGHEST. Order is the
	// payload: consumers derive a tier's ladder position from its index.
	Ranks []string `json:"ranks"`
}

// Season surfaces a competitive season window to the frontend (season
// filter + comparison). Source-of-truth is pkg/parser/seasons.yaml; Start/End
// are UTC RFC3339 strings on the wire.
type Season struct {
	Name    string `json:"name"`
	Chapter string `json:"chapter"`
	Number  int    `json:"number"`
	Start   string `json:"start"`
	End     string `json:"end"`
}

// ScreenshotSource surfaces the parser's per-tool filename grammar
// to the frontend (Settings → Advanced → "Supported capture-source
// rules"). Source-of-truth is pkg/parser/screenshot_sources.yaml;
// the loader fills parser.ScreenshotSources at init time. We
// translate to a JSON-safe view here so the frontend doesn't
// receive a compiled *regexp.Regexp (which can't be marshaled).
type ScreenshotSource struct {
	Name       string `json:"name"`
	Prefix     string `json:"prefix"`
	Regex      string `json:"regex"`
	YearOffset int    `json:"year_offset"`
	Example    string `json:"example"`
}

// GetOWData returns the current OW reference data snapshot. Callers
// must not mutate the returned maps/slices — they are owned by the
// active parser dataset. After an Apply Update call, subsequent
// invocations of GetOWData reflect the swapped dataset.
func (a *App) GetOWData() OWData {
	parserSources := parser.Sources()
	sources := make([]ScreenshotSource, 0, len(parserSources))
	for _, s := range parserSources {
		sources = append(sources, ScreenshotSource{
			Name:       s.Name,
			Prefix:     s.Prefix,
			Regex:      s.Regex.String(),
			YearOffset: s.YearOffset,
			Example:    s.Example,
		})
	}
	parserSeasons := parser.Seasons()
	seasons := make([]Season, 0, len(parserSeasons))
	for _, s := range parserSeasons {
		seasons = append(seasons, Season{
			Name:    s.Name,
			Chapter: s.Chapter,
			Number:  s.Number,
			Start:   s.Start.UTC().Format(time.RFC3339),
			End:     s.End.UTC().Format(time.RFC3339),
		})
	}
	return OWData{
		HeroesByRole:      parser.HeroesByRole(),
		MapsByGameMode:    parser.MapsByGameMode(),
		ScreenshotSources: sources,
		Seasons:           seasons,
		Ranks:             parser.Ranks(),
	}
}
