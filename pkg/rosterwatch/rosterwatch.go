// Package rosterwatch compares the reference data Recall ships against what
// the game actually has, so a new hero, map or patch is noticed the week it
// lands rather than the week a player files an Unknown.
//
// It NEVER decides what the roster says. The one incident this package exists
// to prevent — "Neon Function", an OCR garble transcribed from the parser's own
// output and left canonical for seven weeks — was caused by a name reaching the
// YAML without a human reading it off the screen it comes from. So the output
// is a report and a proposed edit marked unconfirmed; the transcription, the
// guard test and the merge stay with the maintainer.
package rosterwatch

import (
	"fmt"
	"slices"
	"strings"
	"time"

	"recall/pkg/parser"
)

// Finding kinds. Stable strings: the accepted-differences file keys on
// "<kind>:<name>", and the workflow greps them.
const (
	KindHeroMissing   = "hero-missing"
	KindHeroSpelling  = "hero-spelling"
	KindMapMissing    = "map-missing"
	KindPatchMissing  = "patch-missing"
	KindSeasonExpired = "season-expired"
	KindChannelStale  = "channel-stale"
	KindAcceptedStale = "accepted-stale"
)

// Hero and Map are one upstream entry each, narrowed to what a roster edit
// needs: the display name and the key it files under.
type Hero struct {
	Name string
	Role string
}

type Map struct {
	Name     string
	GameMode string
}

// Upstream is what the game says exists.
type Upstream struct {
	Heroes []Hero
	Maps   []Map
	// PatchDates are dates, not instants — Blizzard publishes the day a patch
	// landed and not the hour.
	PatchDates []time.Time
}

// Shipped is what this build of Recall says exists, read through the parser's
// own loaders so the comparison is against exactly what ships.
type Shipped struct {
	HeroesByRole   map[string][]string
	MapsByGameMode map[string][]string
	// NewestPatch is the newest instant in patches.yaml PLUS the season starts
	// derived from seasons.yaml — parser.Patches() already composes both.
	NewestPatch time.Time
	// NewestSeasonEnd is the estimated end of the last season in seasons.yaml.
	NewestSeasonEnd time.Time
}

// ShippedFromParser reads the live roster out of the embedded YAML.
func ShippedFromParser() Shipped {
	s := Shipped{
		HeroesByRole:   parser.HeroesByRole(),
		MapsByGameMode: parser.MapsByGameMode(),
	}
	if patches := parser.Patches(); len(patches) > 0 {
		s.NewestPatch = patches[len(patches)-1].At
	}
	if seasons := parser.Seasons(); len(seasons) > 0 {
		s.NewestSeasonEnd = seasons[len(seasons)-1].End
	}
	return s
}

// Accepted maps "<kind>:<name>" to the reason that difference is fine.
type Accepted map[string]string

// Finding is one thing a human can act on.
type Finding struct {
	Kind string
	// Name is the upstream name (a hero, a map) or a formatted date.
	Name string
	// Group is the key the entry files under — a role, a game mode — or "".
	Group string
	// Detail is the sentence the report prints.
	Detail string
}

// Key is the accepted-differences key for this finding.
func (f Finding) Key() string { return f.Kind + ":" + f.Name }

type Report struct {
	Findings []Finding
}

func (r Report) Drifted() bool { return len(r.Findings) > 0 }

// Compare is the whole judgment. Pure: no I/O, no clock of its own.
//
// `now` is a parameter rather than time.Now() because the season check is the
// one rule that reads the calendar, and a rule that reads the calendar in a
// test is a rule nobody can pin.
func Compare(shipped Shipped, up Upstream, now time.Time, accepted Accepted) Report {
	var r Report
	used := map[string]bool{}

	add := func(f Finding) {
		if _, ok := accepted[f.Key()]; ok {
			used[f.Key()] = true
			return
		}
		r.Findings = append(r.Findings, f)
	}

	for _, f := range heroFindings(shipped, up) {
		add(f)
	}
	for _, f := range mapFindings(shipped, up) {
		add(f)
	}
	for _, f := range patchFindings(shipped, up) {
		add(f)
	}
	if f, ok := seasonFinding(shipped, now); ok {
		add(f)
	}

	// An exemption nothing matches is a stale one, and a stale exemption is how
	// an accepted list stops meaning anything.
	for key, why := range accepted {
		if used[key] {
			continue
		}
		r.Findings = append(r.Findings, Finding{
			Kind: KindAcceptedStale, Name: key,
			Detail: fmt.Sprintf("accepted difference %q matches nothing upstream any more (%s) — delete the line", key, why),
		})
	}
	slices.SortStableFunc(r.Findings, func(a, b Finding) int {
		if c := strings.Compare(a.Kind, b.Kind); c != 0 {
			return c
		}
		return strings.Compare(a.Name, b.Name)
	})
	return r
}

// heroFindings splits "upstream has a name we don't" into the two things it can
// mean. A hero the roster already carries under a different capitalization is a
// SPELLING difference — Blizzard does not delete heroes, and reporting D.Va as
// an addition when D.va is already there asks for a hero the roster has.
func heroFindings(shipped Shipped, up Upstream) []Finding {
	have := map[string]string{} // normalized -> shipped display name
	for _, names := range shipped.HeroesByRole {
		for _, n := range names {
			have[parser.Normalize(n)] = n
		}
	}
	var out []Finding
	for _, h := range up.Heroes {
		shippedName, known := have[parser.Normalize(h.Name)]
		switch {
		case !known:
			out = append(out, Finding{
				Kind: KindHeroMissing, Name: h.Name, Group: h.Role,
				Detail: fmt.Sprintf("hero %q (%s) is upstream and not in heroes.yaml", h.Name, h.Role),
			})
		case shippedName != h.Name:
			out = append(out, Finding{
				Kind: KindHeroSpelling, Name: h.Name, Group: h.Role,
				Detail: fmt.Sprintf("hero spelled %q upstream, %q in heroes.yaml", h.Name, shippedName),
			})
		}
	}
	return out
}

func mapFindings(shipped Shipped, up Upstream) []Finding {
	have := map[string]bool{}
	for _, names := range shipped.MapsByGameMode {
		for _, n := range names {
			have[parser.Normalize(n)] = true
		}
	}
	var out []Finding
	for _, m := range up.Maps {
		if have[parser.Normalize(m.Name)] {
			continue
		}
		out = append(out, Finding{
			Kind: KindMapMissing, Name: m.Name, Group: m.GameMode,
			Detail: fmt.Sprintf("map %q (%s) is upstream and not in maps.yaml", m.Name, m.GameMode),
		})
	}
	return out
}

// patchFindings reports every upstream patch newer than the newest boundary the
// app knows. Compared on the DAY, because that is all Blizzard publishes: a
// patch dated the same day as a shipped boundary is that boundary.
func patchFindings(shipped Shipped, up Upstream) []Finding {
	var out []Finding
	for _, d := range up.PatchDates {
		if !d.UTC().Truncate(24 * time.Hour).After(shipped.NewestPatch.UTC().Truncate(24 * time.Hour)) {
			continue
		}
		day := d.UTC().Format(time.DateOnly)
		out = append(out, Finding{
			Kind: KindPatchMissing, Name: day,
			Detail: fmt.Sprintf("a patch landed on %s, after the newest boundary the app knows (%s)",
				day, shipped.NewestPatch.UTC().Format(time.DateOnly)),
		})
	}
	return out
}

// seasonFinding is local-only. No source publishes the next season's window, so
// the signal is that the shipped one has run out — and seasons.yaml's end is an
// explicit estimate, which is exactly why its expiry is worth saying out loud.
func seasonFinding(shipped Shipped, now time.Time) (Finding, bool) {
	if shipped.NewestSeasonEnd.IsZero() || now.Before(shipped.NewestSeasonEnd) {
		return Finding{}, false
	}
	day := shipped.NewestSeasonEnd.UTC().Format(time.DateOnly)
	return Finding{
		Kind: KindSeasonExpired, Name: day,
		Detail: fmt.Sprintf("the newest season in seasons.yaml ended %s — a new season exists and is not in the file", day),
	}, true
}
