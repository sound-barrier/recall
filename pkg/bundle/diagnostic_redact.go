package bundle

import (
	"regexp"
	"sort"
	"strings"
)

// redactor swaps each redacted path for its placeholder. A path is matched
// case-insensitively (Windows paths are, and a log line may spell the drive
// or the user folder in either case) and in two spellings: as written, and
// with its backslashes doubled the way a quoted log value escapes them.
// Longer paths are replaced first, so a screenshots folder inside the home
// folder reads `[screenshots]`, not `[home]\Pictures\…`.
type redactor struct {
	rules []redactRule
}

type redactRule struct {
	pattern     *regexp.Regexp
	placeholder string
}

func newRedactor(redactions []PathRedaction) redactor {
	usable := make([]PathRedaction, 0, len(redactions))
	for _, r := range redactions {
		// A root or a bare drive would blank every path in the report.
		if len(strings.Trim(r.Path, `/\:.`)) > 1 {
			usable = append(usable, r)
		}
	}
	sort.SliceStable(usable, func(i, j int) bool { return len(usable[i].Path) > len(usable[j].Path) })
	rules := make([]redactRule, 0, len(usable))
	for _, r := range usable {
		spellings := []string{regexp.QuoteMeta(r.Path)}
		if escaped := strings.ReplaceAll(r.Path, `\`, `\\`); escaped != r.Path {
			spellings = append([]string{regexp.QuoteMeta(escaped)}, spellings...)
		}
		rules = append(rules, redactRule{
			pattern:     regexp.MustCompile(`(?i)` + strings.Join(spellings, "|")),
			placeholder: r.Placeholder,
		})
	}
	return redactor{rules: rules}
}

func (r redactor) apply(text string) string {
	for _, rule := range r.rules {
		text = rule.pattern.ReplaceAllLiteralString(text, rule.placeholder)
	}
	return text
}
