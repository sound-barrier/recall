package applog

import "strings"

// Scrub returns s with the carriage-return and newline characters removed.
// Those are what let an attacker-controlled value forge additional log lines
// (CWE-117, log injection): a name like "alt\nERROR user deleted" would render
// as two entries in a line-oriented log. Apply Scrub to any untrusted string
// before passing it as a log field value.
func Scrub(s string) string {
	s = strings.ReplaceAll(s, "\n", "")
	s = strings.ReplaceAll(s, "\r", "")
	return s
}
