// Command roster-watch reports when Overwatch has moved and Recall's reference
// data has not — a new hero, a new map, a patch, an expired season window, or a
// published data channel that never caught up with main.
//
// Maintainer-only tool — never published to GitHub releases. Run locally via
// `task roster-watch`; run weekly by .github/workflows/roster-watch.yml.
//
// Usage:
//
//	roster-watch [--apply] [--season "Season 5 (2026-09-03)"] [--commit <sha>]
//
// Exit codes, and the distinction between the last two is the whole point:
//
//	0  the shipped roster matches the game
//	1  drift found — the report names it
//	2  an upstream could not be read, so nothing was decided
//
// A scrape that silently returns "in sync" because the page it reads was
// redesigned goes quiet in exactly the week the answer stopped being true. Exit
// 2 is how that failure announces itself instead.
//
// --apply writes the entries it is confident in, each marked unconfirmed. It
// never writes seasons.yaml (the window is an estimate no source publishes),
// never writes a hero whose role upstream did not state, and never writes the
// guard test the practice requires. Those stay with a human, by design: the
// roster's one recorded outage came from a name reaching the YAML without
// somebody reading it off the screen it comes from.
package main

import (
	"flag"
	"fmt"
	"os"
	"time"

	"recall/pkg/rosterwatch"
)

func main() {
	var (
		apply    = flag.Bool("apply", false, "write the proposed YAML entries (default: report only)")
		season   = flag.String("season", "", "label written into a proposed entry, e.g. \"Season 5 (2026-09-03)\"")
		commit   = flag.String("commit", "", "SHA of the last commit touching a roster file; enables the published-channel check")
		accepted = flag.String("accepted", "scripts/ci/roster-watch-accepted.txt", "accepted-differences file")
		root     = flag.String("root", ".", "repository root")
	)
	flag.Parse()

	now := time.Now().UTC()
	if *season == "" {
		*season = "Added " + now.Format(time.DateOnly)
	}

	res, err := rosterwatch.Run(rosterwatch.Options{
		RepoRoot:          *root,
		AcceptedPath:      *accepted,
		LocalRosterCommit: *commit,
		Season:            *season,
		Apply:             *apply,
		Now:               now,
		Out:               os.Stdout,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "roster-watch: %v\n", err)
		if rosterwatch.UnreadableSource(err) {
			os.Exit(2)
		}
		os.Exit(2)
	}
	if res.Report.Drifted() {
		os.Exit(1)
	}
}
