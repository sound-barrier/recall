#!/usr/bin/env python3
"""
Render a single combined PR report (unit tests + coverage delta) as
Markdown on stdout. Consumed by the coverage-comment job in
.github/workflows/ci.yml; the output is fed to
marocchino/sticky-pull-request-comment so the PR carries one comment
that reflects both pass/fail and coverage drift vs. main.

Inputs (paths relative to cwd; missing files degrade gracefully):
  pr-tests/*.xml              JUnit XML from the PR's lint job.
  pr-cov/go/cobertura.xml     Go Cobertura XML from this run.
  pr-cov/frontend/cobertura-coverage.xml
                              Vitest Cobertura XML from this run.
  main-cov/go/cobertura.xml   Optional baseline from main's last CI run.
  main-cov/frontend/cobertura-coverage.xml
                              Optional baseline from main's last CI run.

Implemented with stdlib only (xml.etree + glob + os) so it runs on
ubuntu-latest with no pip install — keeping CI deps minimal.
"""

from __future__ import annotations

import contextlib
import glob
import os
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import TypedDict

# `class` is a reserved word, so the failure record (which mirrors the
# JUnit <testcase classname=…> attribute) needs the functional TypedDict
# form to keep that key name.
FailureRecord = TypedDict(
    "FailureRecord",
    {"class": str, "name": str, "message": str},
)


class SuiteSummary(TypedDict):
    name: str
    tests: int
    failures: int
    skipped: int
    time: float
    failure_records: list[FailureRecord]


def find_one(*patterns: str) -> str | None:
    """Return the first file matching any of the given glob patterns."""
    for p in patterns:
        for path in sorted(glob.glob(p, recursive=True)):
            if os.path.isfile(path):
                return path
    return None


def parse_cobertura_line_rate(path: str | None) -> float | None:
    """Read the top-level <coverage line-rate="X"> attribute as a percentage."""
    if not path or not os.path.isfile(path):
        return None
    try:
        root = ET.parse(path).getroot()
        rate = float(root.attrib.get("line-rate", "0"))
        return rate * 100.0
    except (ET.ParseError, ValueError, OSError):
        return None


def summarize_junit_files(pattern: str) -> list[SuiteSummary]:
    """Return one summary per JUnit XML file: name + aggregate counts + failures."""
    out: list[SuiteSummary] = []
    for path in sorted(glob.glob(pattern)):
        try:
            root = ET.parse(path).getroot()
        except (ET.ParseError, OSError):
            continue
        suite_name = os.path.basename(path)
        for suffix in ("-junit.xml", "-junit.json", ".xml"):
            if suite_name.endswith(suffix):
                suite_name = suite_name[: -len(suffix)]
                break

        # The file root is either <testsuites> wrapping multiple <testsuite>s
        # (vitest) or a single <testsuite> (some go-junit-report variants).
        # iter('testsuite') handles both shapes uniformly.
        tests = failures = errors = skipped = 0
        total_time = 0.0
        failure_records: list[FailureRecord] = []
        for ts in root.iter("testsuite"):
            tests += int(ts.attrib.get("tests", "0"))
            failures += int(ts.attrib.get("failures", "0"))
            errors += int(ts.attrib.get("errors", "0"))
            skipped += int(ts.attrib.get("skipped", "0"))
            # Ignore malformed/non-numeric time values (treat as 0) so the
            # rest of the report still renders.
            with contextlib.suppress(ValueError):
                total_time += float(ts.attrib.get("time", "0") or 0)
            for tc in ts.iter("testcase"):
                for fail in list(tc.findall("failure")) + list(tc.findall("error")):
                    msg = (fail.attrib.get("message") or fail.text or "").strip()
                    # Truncate so a screenful of stack doesn't explode the comment.
                    if len(msg) > 600:
                        msg = msg[:600].rstrip() + " …"
                    failure_records.append(
                        {
                            "class": tc.attrib.get("classname", ""),
                            "name": tc.attrib.get("name", ""),
                            "message": msg,
                        }
                    )

        out.append(
            {
                "name": suite_name,
                "tests": tests,
                "failures": failures + errors,
                "skipped": skipped,
                "time": total_time,
                "failure_records": failure_records,
            }
        )
    return out


def fmt_pct(v: float | None) -> str:
    return f"{v:.2f}%" if v is not None else "—"


def fmt_delta(pr: float | None, base: float | None) -> str:
    if pr is None or base is None:
        return "—"
    d = pr - base
    if abs(d) < 0.005:
        return "±0.00%"
    sign = "+" if d > 0 else ""
    return f"{sign}{d:.2f}%"


def delta_emoji(pr: float | None, base: float | None) -> str:
    if pr is None or base is None:
        return ""
    d = pr - base
    if abs(d) < 0.005:
        return ""
    return " ▲" if d > 0 else " ▼"


def build_tests_section(suites: list[SuiteSummary]) -> list[str]:
    """The "Unit tests" heading + per-suite table + optional failure details."""
    total_tests = sum(s["tests"] for s in suites)
    total_failures = sum(s["failures"] for s in suites)
    total_skipped = sum(s["skipped"] for s in suites)
    total_time = sum(s["time"] for s in suites)
    total_passed = total_tests - total_failures - total_skipped

    icon = (
        "✅"
        if total_failures == 0 and total_tests > 0
        else ("⚠️" if total_tests == 0 else "❌")
    )

    out: list[str] = [f"### {icon} Unit tests", ""]
    if total_tests == 0:
        out.append("_No JUnit reports found in `pr-tests/`._")
    else:
        out.append("| Suite | Passed | Failed | Skipped | Time |")
        out.append("|---|---:|---:|---:|---:|")
        for s in suites:
            passed = s["tests"] - s["failures"] - s["skipped"]
            out.append(
                f"| `{s['name']}` | {passed} | {s['failures']} | {s['skipped']} | {s['time']:.2f}s |"
            )
        out.append(
            f"| **Total** | **{total_passed}** | **{total_failures}** | **{total_skipped}** | **{total_time:.2f}s** |"
        )
    out.append("")

    if total_failures > 0:
        out.append("<details><summary>Failure details</summary>")
        out.append("")
        for s in suites:
            if not s["failure_records"]:
                continue
            out.append(f"#### `{s['name']}`")
            out.append("")
            for f in s["failure_records"]:
                qualified = f"{f['class']}.{f['name']}" if f["class"] else f["name"]
                out.append(f"- **{qualified}**")
                if f["message"]:
                    out.append("  ```")
                    for line in f["message"].splitlines():
                        out.append(f"  {line}")
                    out.append("  ```")
        out.append("")
        out.append("</details>")
        out.append("")
    return out


def build_coverage_section(
    pr_go: float | None,
    main_go: float | None,
    pr_fe: float | None,
    main_fe: float | None,
    e2e_go: float | None,
    e2e_fe: float | None,
) -> list[str]:
    """The "Coverage" heading + Unit (this-PR-vs-main) + Integration table.

    Unit columns carry the main-baseline Δ. The Integration (e2e) column is
    informational and baseline-free — it comes from the separate E2E workflow,
    whose artifacts may not be ready when this renders (then "—")."""
    out: list[str] = ["### 📊 Coverage", ""]
    out.append("| Component | Unit | main | Δ | Integration (e2e) |")
    out.append("|---|---:|---:|---:|---:|")
    out.append(
        f"| Go       | {fmt_pct(pr_go)} | {fmt_pct(main_go)} | {fmt_delta(pr_go, main_go)}{delta_emoji(pr_go, main_go)} | {fmt_pct(e2e_go)} |"
    )
    out.append(
        f"| Frontend | {fmt_pct(pr_fe)} | {fmt_pct(main_fe)} | {fmt_delta(pr_fe, main_fe)}{delta_emoji(pr_fe, main_fe)} | {fmt_pct(e2e_fe)} |"
    )
    out.append("")
    if main_go is None or main_fe is None:
        out.append(
            "_Unit baseline missing for at least one component — main has no recent successful CI run yet, or the baseline artifact has aged out. The Δ will populate after the next push to main._"
        )
        out.append("")
    if e2e_go is None and e2e_fe is None:
        out.append(
            "_Integration (e2e) coverage pending — the E2E workflow runs in parallel and may not have finished for this commit yet. It populates from the latest E2E run on the branch._"
        )
        out.append("")
    return out


def main() -> int:
    pr_tests = summarize_junit_files("pr-tests/*.xml")
    pr_go = parse_cobertura_line_rate("pr-cov/go/cobertura.xml")
    pr_fe = parse_cobertura_line_rate(
        find_one(
            "pr-cov/frontend/cobertura-coverage.xml",
            "pr-cov/frontend/**/cobertura-coverage.xml",
        )
    )
    main_go = parse_cobertura_line_rate("main-cov/go/cobertura.xml")
    main_fe = parse_cobertura_line_rate(
        find_one(
            "main-cov/frontend/cobertura-coverage.xml",
            "main-cov/frontend/**/cobertura-coverage.xml",
        )
    )
    # Integration (e2e) coverage from the separate E2E workflow's artifacts
    # (downloaded cross-workflow by the pr-report job). Optional — renders as
    # "—" when the E2E run hasn't produced them yet.
    e2e_go = parse_cobertura_line_rate("pr-cov-e2e/go/cobertura.xml")
    e2e_fe = parse_cobertura_line_rate(
        find_one(
            "pr-cov-e2e/frontend/cobertura-coverage.xml",
            "pr-cov-e2e/frontend/**/cobertura-coverage.xml",
        )
    )

    out = build_tests_section(pr_tests)
    out += build_coverage_section(pr_go, main_go, pr_fe, main_fe, e2e_go, e2e_fe)

    ts = datetime.now(timezone.utc).isoformat(timespec="seconds")
    out.append(f"<sub>Updated {ts} · sticky comment</sub>")

    sys.stdout.write("\n".join(out) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
