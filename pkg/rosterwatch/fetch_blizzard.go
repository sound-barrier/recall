package rosterwatch

import (
	"fmt"
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

// A hero card links to /heroes/<slug>/ and carries the display name in its
// text. The role rides on the card as a data attribute; when it does not, the
// hero is still reported — just without a role, so the tool declines to write
// it and asks a human which key it files under.
var (
	heroCardRe = regexp.MustCompile(`(?is)<a[^>]+href="[^"]*/heroes/([a-z0-9\-]+)/?"[^>]*>(.*?)</a>`)
	roleAttrRe = regexp.MustCompile(`(?i)data-role="([a-z]+)"`)
	tagRe      = regexp.MustCompile(`(?s)<[^>]*>`)
)

// FetchHeroes reads Blizzard's hero index.
func FetchHeroes(client *http.Client) ([]Hero, error) {
	body, err := getBytes(client, HeroesURL)
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	var out []Hero
	for _, m := range heroCardRe.FindAllSubmatch(body, -1) {
		name := textOf(m[2])
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		out = append(out, Hero{Name: name, Role: roleFrom(string(m[0]))})
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("%w: no hero cards at %s", ErrSourceUnreadable, HeroesURL)
	}
	return out, nil
}

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

// textOf strips tags and entities out of a fragment's inner HTML.
func textOf(fragment []byte) string {
	return strings.TrimSpace(unescape.Replace(string(tagRe.ReplaceAll(fragment, []byte(" ")))))
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
