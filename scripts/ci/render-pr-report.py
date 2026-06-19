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
    return _parse_cobertura_rate(path, "line-rate")


def parse_cobertura_branch_rate(path: str | None) -> float | None:
    """Read the top-level <coverage branch-rate="X"> attribute as a percentage.

    Real for the frontend (V8 reports branch coverage); the Go Cobertura that
    gocover-cobertura emits has branch-rate=0 (Go has no native branch coverage),
    so Go branch coverage comes from parse_go_block_coverage instead.
    """
    return _parse_cobertura_rate(path, "branch-rate")


def _parse_cobertura_rate(path: str | None, attr: str) -> float | None:
    if not path or not os.path.isfile(path):
        return None
    try:
        root = ET.parse(path).getroot()
        return float(root.attrib.get(attr, "0")) * 100.0
    except (ET.ParseError, ValueError, OSError):
        return None


def parse_go_block_coverage(path: str | None) -> float | None:
    """Go's branch-equivalent: basic-block coverage from a coverprofile.

    Go has no native branch coverage. Its coverprofile records one row per basic
    block — a maximal run of statements with no branch in or out — as
    `file:start.col,end.col numStmt count`. Each block sits between branch points,
    so the fraction of blocks executed tracks branch outcomes far better than the
    statement-weighted `go tool cover -func` total. Returns covered/total blocks
    as a percentage.
    """
    if not path or not os.path.isfile(path):
        return None
    total = covered = 0
    try:
        with open(path, encoding="utf-8") as fh:
            for i, raw in enumerate(fh):
                if i == 0 and raw.startswith("mode:"):
                    continue
                fields = raw.split()
                if len(fields) < 3:
                    continue
                total += 1
                if int(fields[-1]) > 0:
                    covered += 1
    except (OSError, ValueError):
        return None
    return 100.0 * covered / total if total else None


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


Cov = tuple["float | None", "float | None", "float | None", "float | None"]


def _cov_row(
    label: str,
    pr: float | None,
    base: float | None,
    e2e: float | None,
    base_e2e: float | None,
) -> str:
    return (
        f"| {label} | {fmt_pct(pr)} | {fmt_pct(base)} | "
        f"{fmt_delta(pr, base)}{delta_emoji(pr, base)} | "
        f"{fmt_pct(e2e)} | {fmt_pct(base_e2e)} | "
        f"{fmt_delta(e2e, base_e2e)}{delta_emoji(e2e, base_e2e)} |"
    )


def _cov_table(heading: str, go_label: str, go: Cov, fe: Cov) -> list[str]:
    """One coverage table — each component as (pr, main, e2e, main_e2e)."""
    return [
        heading,
        "",
        "| Component | Unit | main | Δ | Integration (e2e) | main | Δ |",
        "|---|---:|---:|---:|---:|---:|---:|",
        _cov_row(go_label, *go),
        _cov_row("Frontend", *fe),
        "",
    ]


def build_coverage_section(
    line_go: Cov, line_fe: Cov, branch_go: Cov, branch_fe: Cov
) -> list[str]:
    """The Coverage heading + a Line table and a Branch table.

    Each component carries a Unit and an Integration (e2e) figure, both with a
    main-baseline Δ. Go branch coverage is basic-block coverage — Go has no native
    branch coverage — while the frontend figure is V8's true branch coverage. The
    e2e figures come from the separate E2E workflow, "—" until it finishes."""
    out: list[str] = ["## 📊 Coverage", ""]
    out += _cov_table("### Line", "Go", line_go, line_fe)
    out += _cov_table("### Branch", "Go (block)¹", branch_go, branch_fe)
    out.append(
        "¹ Go has no native branch coverage — this is basic-block coverage "
        "(each block sits between branch points, so it tracks branch outcomes)."
    )
    out.append("")
    # Baseline / pending notes keyed off the Line table's Unit + e2e figures.
    main_go, e2e_go, main_e2e_go = line_go[1], line_go[2], line_go[3]
    main_fe, e2e_fe, main_e2e_fe = line_fe[1], line_fe[2], line_fe[3]
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
    elif main_e2e_go is None or main_e2e_fe is None:
        out.append(
            "_Integration (e2e) baseline missing for at least one component — main has had no recent e2e-relevant run, or the artifact aged out. The e2e Δ will populate after the next push to main._"
        )
        out.append("")
    return out


def main() -> int:
    pr_tests = summarize_junit_files("pr-tests/*.xml")
    # Each frontend Cobertura is resolved once — it carries BOTH line-rate and
    # branch-rate (V8 reports real branch coverage). The four sources: this PR's
    # unit + e2e, and main's unit + e2e baselines. e2e artifacts are optional
    # ("—" until the parallel E2E workflow finishes / a baseline exists).
    fe_xml = (
        find_one(
            "pr-cov/frontend/cobertura-coverage.xml",
            "pr-cov/frontend/**/cobertura-coverage.xml",
        ),
        find_one(
            "main-cov/frontend/cobertura-coverage.xml",
            "main-cov/frontend/**/cobertura-coverage.xml",
        ),
        find_one(
            "pr-cov-e2e/frontend/cobertura-coverage.xml",
            "pr-cov-e2e/frontend/**/cobertura-coverage.xml",
        ),
        find_one(
            "main-cov-e2e/frontend/cobertura-coverage.xml",
            "main-cov-e2e/frontend/**/cobertura-coverage.xml",
        ),
    )

    # Line coverage — Go + frontend Cobertura line-rate.
    line_go: Cov = (
        parse_cobertura_line_rate("pr-cov/go/cobertura.xml"),
        parse_cobertura_line_rate("main-cov/go/cobertura.xml"),
        parse_cobertura_line_rate("pr-cov-e2e/go/cobertura.xml"),
        parse_cobertura_line_rate("main-cov-e2e/go/cobertura.xml"),
    )
    line_fe: Cov = tuple(parse_cobertura_line_rate(x) for x in fe_xml)  # type: ignore[assignment]

    # Branch coverage — Go from basic-block coverage of its coverprofile (no
    # native branch coverage), frontend from the Cobertura branch-rate.
    branch_go: Cov = (
        parse_go_block_coverage("pr-cov/go/coverage.out"),
        parse_go_block_coverage("main-cov/go/coverage.out"),
        parse_go_block_coverage("pr-cov-e2e/go/coverage.out"),
        parse_go_block_coverage("main-cov-e2e/go/coverage.out"),
    )
    branch_fe: Cov = tuple(parse_cobertura_branch_rate(x) for x in fe_xml)  # type: ignore[assignment]

    out = build_tests_section(pr_tests)
    out += build_coverage_section(line_go, line_fe, branch_go, branch_fe)

    ts = datetime.now(timezone.utc).isoformat(timespec="seconds")
    out.append(f"<sub>Updated {ts} · sticky comment</sub>")

    sys.stdout.write("\n".join(out) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
