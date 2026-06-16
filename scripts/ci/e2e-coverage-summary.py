#!/usr/bin/env python3
"""Print the integration (e2e) coverage summary as Markdown on stdout.

Appended to $GITHUB_STEP_SUMMARY by the e2e workflow so the Playwright
run's Go + frontend integration coverage is visible on the job page
without downloading the artifacts. Informational only — never a gate.

Reads (relative to repo root):
  coverage/e2e/go/coverage.txt                  Go `go tool cover -func` output
  coverage/e2e/frontend/cobertura-coverage.xml  monocart frontend Cobertura

Both inputs are optional; a missing one renders as "—". Stdlib only.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET


def go_total(path: str) -> str:
    """Pull the `total:` line percentage out of `go tool cover -func` output."""
    try:
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("total:"):
                    m = re.search(r"(\d+\.\d+)%", line)
                    if m:
                        return f"{float(m.group(1)):.1f}%"
    except OSError:
        pass
    return "—"


def cobertura_line_rate(path: str) -> str:
    """Read the top-level <coverage line-rate="X"> attribute as a percentage."""
    try:
        root = ET.parse(path).getroot()
        rate = root.get("line-rate")
        if rate is not None:
            return f"{float(rate) * 100:.1f}%"
    except (OSError, ET.ParseError, ValueError):
        pass
    return "—"


def main() -> int:
    go = go_total("coverage/e2e/go/coverage.txt")
    frontend = cobertura_line_rate("coverage/e2e/frontend/cobertura-coverage.xml")
    print("## Integration (e2e) coverage")
    print()
    print(
        "Produced by the Playwright suite driving the real serveronly binary "
        "— informational, not a merge gate."
    )
    print()
    print("| Layer | Lines |")
    print("|---|---|")
    print(f"| Go (HTTP handlers) | {go} |")
    print(f"| Frontend (Vue / TS) | {frontend} |")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
