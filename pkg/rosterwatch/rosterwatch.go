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
	KindMapSpelling   = "map-spelling"
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
	have := map[string]string{} // comparison key -> shipped display name
	for _, names := range shipped.HeroesByRole {
		for _, n := range names {
			have[compareKey(n)] = n
		}
	}
	var out []Finding
	for _, h := range up.Heroes {
		shippedName, known := have[compareKey(h.Name)]
		if !known {
			if near := nearest(h.Name, have); near != "" {
				out = append(out, Finding{
					Kind: KindHeroSpelling, Name: h.Name, Group: h.Role,
					Detail: fmt.Sprintf("hero named %q upstream, %q in heroes.yaml — one is a typo, not two heroes", h.Name, near),
				})
				continue
			}
			out = append(out, Finding{
				Kind: KindHeroMissing, Name: h.Name, Group: h.Role,
				Detail: fmt.Sprintf("hero %q (%s) is upstream and not in heroes.yaml", h.Name, h.Role),
			})
			continue
		}
		if sameButForQuotes(shippedName, h.Name) {
			continue
		}
		out = append(out, Finding{
			Kind: KindHeroSpelling, Name: h.Name, Group: h.Role,
			Detail: fmt.Sprintf("hero spelled %q upstream, %q in heroes.yaml", h.Name, shippedName),
		})
	}
	return out
}

// mapFindings compares only the modes maps.yaml actually files under.
//
// Upstream lists every map in the game — deathmatch, elimination, the workshop
// rooms, the practice range. maps.yaml is the COMPETITIVE roster, and proposing
// two dozen arcade maps would bury the one new competitive map among them. The
// tracked set is read off the shipped file, so it cannot drift from it.
//
// A mode the roster does not track yet is therefore invisible here. That is the
// right trade: a new game mode is a bigger change than a bot should propose — it
// needs a regex in text.go and an entry in the frontend's GAME_MODES  and the
// patch-notes signal announces one anyway.
func mapFindings(shipped Shipped, up Upstream) []Finding {
	tracked := map[string]bool{}
	have := map[string]string{} // comparison key -> shipped display name
	for mode, names := range shipped.MapsByGameMode {
		tracked[mode] = true
		for _, n := range names {
			have[compareKey(n)] = n
		}
	}
	var out []Finding
	for _, m := range up.Maps {
		if !tracked[m.GameMode] {
			continue
		}
		shippedName, known := have[compareKey(m.Name)]
		if !known {
			if near := nearest(m.Name, have); near != "" {
				out = append(out, Finding{
					Kind: KindMapSpelling, Name: m.Name, Group: m.GameMode,
					Detail: fmt.Sprintf("map named %q upstream, %q in maps.yaml — one is a typo, not two maps", m.Name, near),
				})
				continue
			}
			out = append(out, Finding{
				Kind: KindMapMissing, Name: m.Name, Group: m.GameMode,
				Detail: fmt.Sprintf("map %q (%s) is upstream and not in maps.yaml", m.Name, m.GameMode),
			})
			continue
		}
		if sameButForQuotes(shippedName, m.Name) {
			continue
		}
		out = append(out, Finding{
			Kind: KindMapSpelling, Name: m.Name, Group: m.GameMode,
			Detail: fmt.Sprintf("map spelled %q upstream, %q in maps.yaml", m.Name, shippedName),
		})
	}
	return out
}

// maxTypoDistance is how far apart two names can be and still be one name
// spelled two ways.
//
// Two is enough for a transposition ("Hanoaka" / "Hanaoka") or a single
// substituted letter ("Neon Function" / "Neon Junction" — the garble that sat
// canonical in maps.yaml for seven weeks), and tight enough that two genuinely
// different short names do not collapse into one. A near miss is REPORTED, never
// written: which of the two spellings is right is exactly the judgment a
// scraper cannot make.
var quoteFold = strings.NewReplacer("\u2019", "'", "\u2018", "'", "\u02bc", "'")

const maxTypoDistance = 2

// nearest returns the shipped name a near-miss upstream name probably IS, or
// "" when nothing is close enough to be a spelling of it.
func nearest(name string, have map[string]string) string {
	key := compareKey(name)
	best, bestDist := "", maxTypoDistance+1
	for shippedKey, display := range have {
		// A short name can be two edits from an unrelated one, so the guard is
		// on length as well as distance.
		if len(shippedKey) < 5 || len(key) < 5 {
			continue
		}
		if d := editDistance(shippedKey, key); d < bestDist {
			best, bestDist = display, d
		}
	}
	if bestDist > maxTypoDistance {
		return ""
	}
	return best
}

// editDistance is Levenshtein over runes. pkg/parser has one, unexported and
// tuned for snapping OCR noise onto the roster; this one answers a different
// question — whether two CANONICAL names are one typo apart — so it lives here
// rather than widening that one's surface.
func editDistance(a, b string) int {
	ar, br := []rune(a), []rune(b)
	prev := make([]int, len(br)+1)
	curr := make([]int, len(br)+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= len(ar); i++ {
		curr[0] = i
		for j := 1; j <= len(br); j++ {
			cost := 1
			if ar[i-1] == br[j-1] {
				cost = 0
			}
			curr[j] = min(min(curr[j-1]+1, prev[j]+1), prev[j-1]+cost)
		}
		prev, curr = curr, prev
	}
	return prev[len(br)]
}

// compareKey is how two spellings of one name are recognized as one name.
//
// parser.Normalize does the heavy lifting — lowercase, diacritics, the colon in
// "Watchpoint: Gibraltar" — but it does not touch quote marks, and upstream
// writes King’s Row with a typographic apostrophe where the roster uses the
// ASCII one. Folded HERE rather than in Normalize: that function decides what
// OCR text matches the roster, and widening it would change parsing everywhere
// to fix a difference that only exists between this repo and a web page.
func compareKey(name string) string {
	return parser.Normalize(quoteFold.Replace(name))
}

// sameButForQuotes reports whether two display names differ only in quote
// style. Upstream renders King’s Row with a typographic apostrophe; the roster
// uses the ASCII one, and neither is wrong — reporting it every week would be
// noise the maintainer has to silence rather than a difference to act on.
func sameButForQuotes(a, b string) bool {
	return quoteFold.Replace(a) == quoteFold.Replace(b)
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
