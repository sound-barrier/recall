package app

import "recall/pkg/parser"

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
	MapsByType        map[string][]string `json:"maps_by_type"`
	ScreenshotSources []ScreenshotSource  `json:"screenshot_sources"`
}

// ScreenshotSource surfaces the parser's per-tool filename grammar
// to the frontend (Settings → Advanced → "Supported capture-source
// rules"). Source-of-truth is pkg/parser/screenshot_sources.yaml;
// the loader fills parser.ScreenshotSources at init time. We
// translate to a JSON-safe view here so the frontend doesn't
// receive a compiled *regexp.Regexp (which can't be marshalled).
type ScreenshotSource struct {
	Name       string `json:"name"`
	Prefix     string `json:"prefix"`
	Regex      string `json:"regex"`
	YearOffset int    `json:"year_offset"`
	Example    string `json:"example"`
}

// GetOWData returns the embedded OW reference data. Stateless +
// idempotent — callers may invoke it once at app load and cache.
// The returned maps are the package-level singletons; callers must
// not mutate them.
func (a *App) GetOWData() OWData {
	sources := make([]ScreenshotSource, 0, len(parser.ScreenshotSources))
	for _, s := range parser.ScreenshotSources {
		sources = append(sources, ScreenshotSource{
			Name:       s.Name,
			Prefix:     s.Prefix,
			Regex:      s.Regex.String(),
			YearOffset: s.YearOffset,
			Example:    s.Example,
		})
	}
	return OWData{
		HeroesByRole:      parser.HeroesByRole,
		MapsByType:        parser.MapsByType,
		ScreenshotSources: sources,
	}
}
