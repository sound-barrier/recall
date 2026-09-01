package rosterwatch

import (
	"fmt"
	"html"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// Blizzard's own pages, read with regexes rather than an HTML parser.
//
// A parser would be sturdier, and it would also be a new module in a repo whose
// rule is to prefer the standard library. The trade is acceptable BECAUSE of
// ErrSourceUnreadable: when these patterns stop matching, the tool says so
// instead of guessing, so the cost of a Blizzard redesign is a red job and a
// one-line fix, not a wrong roster.

// A hero card is an <a class="hero-card"> carrying the role as a data
// attribute and the display name in an <h2 slot="heading">.
//
// The NAME comes from that heading and not from the card's text, which also
// contains a "New" badge — reading the whole card gave every hero on the live
// page a name like "Ana      New" while a hand-written fixture said otherwise.
// The recorded fixture carries the badge for that reason.
var (
	heroCardRe    = regexp.MustCompile(`(?is)<a[^>]*class="hero-card".*?</a>`)
	heroHeadingRe = regexp.MustCompile(`(?is)<h2[^>]*slot="heading"[^>]*>(.*?)</h2>`)
	roleAttrRe    = regexp.MustCompile(`(?i)data-role="([a-z]+)"`)
	tagRe         = regexp.MustCompile(`(?s)<[^>]*>`)
	// Comments are stripped before any of the above run. A comment that talks
	// ABOUT the markup matches the pattern for the markup — which this
	// package's own fixture proved, by describing the card it contains.
	commentRe = regexp.MustCompile(`(?s)<!--.*?-->`)
)

// FetchHeroes reads Blizzard's hero index.
func FetchHeroes(client *http.Client) ([]Hero, error) {
	body, err := getBytes(client, HeroesURL)
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	var out []Hero
	for _, card := range heroCardRe.FindAll(stripComments(body), -1) {
		heading := heroHeadingRe.FindSubmatch(card)
		if heading == nil {
			continue
		}
		name := textOf(heading[1])
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		out = append(out, Hero{Name: name, Role: roleFrom(string(card))})
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("%w: no hero cards at %s", ErrSourceUnreadable, HeroesURL)
	}
	return out, nil
}

func stripComments(doc []byte) []byte { return commentRe.ReplaceAll(doc, nil) }

// roleFrom maps Blizzard's role word onto the key heroes.yaml files under.
// Their "damage" is this repo's "dps" — the YAML key, and the string every
// role filter in the app compares against.
func roleFrom(card string) string {
	m := roleAttrRe.FindStringSubmatch(card)
	if m == nil {
		return ""
	}
	switch strings.ToLower(m[1]) {
	case "damage", "dps":
		return "dps"
	case "tank":
		return "tank"
	case "support":
		return "support"
	}
	return ""
}

// textOf strips tags out of a fragment and decodes entities.
//
// html.UnescapeString rather than a hand-kept replacer: these names are about
// to be proposed as canonical, and a half-decoded one is precisely the class of
// error — a name that looks almost right — this package exists to catch.
func textOf(fragment []byte) string {
	return strings.TrimSpace(html.UnescapeString(string(tagRe.ReplaceAll(fragment, []byte(" ")))))
}

// Blizzard writes every patch heading as "Overwatch ... Patch Notes – <date>",
// with an en dash. The wording between "Overwatch" and "Patch Notes" has
// changed before ("Retail", "Season"), so it is not pinned.
var patchHeadingRe = regexp.MustCompile(
	`(?i)Overwatch[^<>]{0,40}?Patch Notes\s*(?:&ndash;|[–-])\s*([A-Z][a-z]+ \d{1,2}, \d{4})`)

// FetchPatchDates reads the live patch-notes list, newest first as published.
//
// Dates only. Blizzard publishes the day a patch landed and not the hour, and
// patches.yaml wants an instant — which is why the caller writes the entry
// marked unconfirmed rather than pretending it read a time.
func FetchPatchDates(client *http.Client) ([]time.Time, error) {
	body, err := getBytes(client, PatchNotesURL)
	if err != nil {
		return nil, err
	}
	body = stripComments(body)
	seen := map[string]bool{}
	var out []time.Time
	for _, m := range patchHeadingRe.FindAllSubmatch(body, -1) {
		raw := strings.TrimSpace(string(m[1]))
		if seen[raw] {
			continue
		}
		seen[raw] = true
		d, err := time.Parse("January 2, 2006", raw)
		if err != nil {
			// A heading that matched the shape but not the date is drift in the
			// source, not a patch — say so rather than skipping quietly.
			return nil, fmt.Errorf("%w: patch heading %q is not a date: %w", ErrSourceUnreadable, raw, err)
		}
		out = append(out, d.UTC())
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("%w: no patch headings at %s", ErrSourceUnreadable, PatchNotesURL)
	}
	return out, nil
}
