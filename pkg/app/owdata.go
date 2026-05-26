package app

import "recall/pkg/parser"

// OWData is the read-only Overwatch reference data the parser is keyed
// against — the canonical hero roster (per role) and map roster (per
// game type). The bytes ultimately come from `pkg/parser/heroes.yaml`
// and `pkg/parser/maps.yaml`, embedded at compile time. Surfaced to
// the frontend via the /api/owdata HTTP route + the Wails-bound
// `App.GetOWData` so the UI can render canonical names (with diacritic
// + capitalization preserved) and group heroes by role / maps by type
// without re-shipping the same lists in TypeScript.
type OWData struct {
	HeroesByRole map[string][]string `json:"heroes_by_role"`
	MapsByType   map[string][]string `json:"maps_by_type"`
}

// GetOWData returns the embedded OW reference data. Stateless +
// idempotent — callers may invoke it once at app load and cache.
// The returned maps are the package-level singletons; callers must
// not mutate them.
func (a *App) GetOWData() OWData {
	return OWData{
		HeroesByRole: parser.HeroesByRole,
		MapsByType:   parser.MapsByType,
	}
}
