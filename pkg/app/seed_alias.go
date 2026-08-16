package app

import "recall/pkg/seed"

// The synthetic-corpus writer lives in pkg/seed (carved out per the
// decomposition plan). These aliases keep cmd/seed-dev's
// app.SeedProfile/app.SeedOptions usage and profile_app.go's
// SeedTestProfile call byte-identical.

// SeedOptions parameterizes a seed run.
type SeedOptions = seed.Options

// SeedResult summarizes what a seed run produced (or found).
type SeedResult = seed.Result

// SeedProfile creates the named profile if absent and seeds it with
// opts.N synthetic matches in a TRANSIENT store at its db path (never
// the App's active store). Kept at package level for cmd/seed-dev and
// the SeedTestProfile handler.
func SeedProfile(p *Profiles, name string, opts SeedOptions) (SeedResult, error) {
	return seed.Profile(p, name, opts)
}
