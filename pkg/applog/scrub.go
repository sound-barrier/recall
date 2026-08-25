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

// lineFold separates the frames of a folded multi-line log line.
const lineFold = " | "

// foldLineBreaks replaces the line breaks inside one stdlib log line.
//
// FOLDING, not deleting the way Scrub does, because this is the one input in
// the codebase that is legitimately multi-line: net/http's panic recovery
// writes a whole goroutine stack through log.Printf (RunServer's http.Server
// sets no ErrorLog), and parser.Reload returns an errors.Join whose Error()
// is newline-separated. Delete the breaks and the frames fuse — "boom" and
// "goroutine 42" become "boomgoroutine 42". Folding keeps them legible.
//
// Losing the raw CR/LF is also what denies CWE-117 the bytes that forge a
// second entry. Both handlers already escape them, so nothing was exploitable
// here; what this ends is a run-on escaped blob where a readable line belongs.
// CRLF goes first: the pair must fold once, not twice.
func foldLineBreaks(s string) string {
	s = strings.ReplaceAll(s, "\r\n", lineFold)
	s = strings.ReplaceAll(s, "\n", lineFold)
	s = strings.ReplaceAll(s, "\r", lineFold)
	return s
}
