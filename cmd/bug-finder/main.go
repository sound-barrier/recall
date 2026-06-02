// Command recall-bug-finder cross-validates a Recall export bundle
// (the `.zip` produced by `POST /api/v1/exports/bundle` / Wails'
// SaveBundleToFile / the in-app "Export bundle…" affordance).
//
// Maintainer-only tool — never published to GitHub releases.
// Built locally via `make bug-finder`, which drops the binary at
// `build/bin/recall-bug-finder`.
//
// Usage:
//
//	recall-bug-finder <bundle.zip>
//
// Exits 0 when the bundle is internally consistent. Exits 1 (or 2 on
// argument / IO error) and prints every discrepancy with a stable
// `[kind] message` prefix so a scripted wrapper can grep on the
// kind without re-parsing the human-readable text.
package main

import (
	"fmt"
	"os"

	"recall/pkg/app"
)

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: recall-bug-finder <bundle.zip>")
		os.Exit(2)
	}
	path := os.Args[1]

	// #nosec G304 G703 -- the path is supplied by the maintainer on
	// the command line. This tool is intentionally not exposed to
	// untrusted input — it never ships in a release.
	data, err := os.ReadFile(path)
	if err != nil {
		fmt.Fprintf(os.Stderr, "read %s: %v\n", path, err)
		os.Exit(2)
	}

	issues, err := app.ValidateBundle(data)
	if err != nil {
		fmt.Fprintf(os.Stderr, "validate %s: %v\n", path, err)
		os.Exit(2)
	}

	if len(issues) == 0 {
		fmt.Printf("✓ %s — bundle is internally consistent\n", path)
		os.Exit(0)
	}

	fmt.Printf("✗ %s — %d issue(s)\n", path, len(issues))
	for _, iss := range issues {
		fmt.Printf("  [%s] %s\n", iss.Kind, iss.Message)
	}
	os.Exit(1)
}
