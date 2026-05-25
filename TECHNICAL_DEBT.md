# Technical Debt

Living inventory of known technical debt in the Recall codebase. Each
item has the same four-section shape so they can be triaged, scoped,
and worked off independently. Update this file whenever debt is added
(record it the same week, with the same rigor) or paid down (delete
the section — not "strikethrough", not "✅", just delete it; git
history is the audit trail).

## How to read this file

Each item carries a **size** estimate that combines coding effort with
review/test/release surface area:

| Size | Rough effort | Examples |
|---|---|---|
| **S**  | < 2 hours | A single-file rename, one Makefile var, one config flip. |
| **M**  | ½–2 days | A refactor inside one package; new test file; small DI seam. |
| **L**  | 2–5 days | Multi-package refactor; new abstraction with migrations; CI rewiring. |
| **XL** | 1–2 weeks | Rewriting a monolith; introducing a new runtime dependency; reshaping an entire layer. |

A **plan** is a sequence of *small, independently mergeable* steps. If
a step needs a release or a contributor handoff, that's marked in line.
Anything that has to land atomically is called out.

The list is ordered by *risk × cost-to-fix-later*, not by size. The
top items are the ones most likely to bite if left alone. Pay them off
first.

---

## 12. Parser golden-file fixtures — privacy-reviewed commit pending

**Size: S**

**What.**
The infrastructure work landed: `pkg/parser/integration_test.go`
defaults `RECALL_FIXTURE_DIR` to `pkg/parser/testdata/golden/`,
`make update-goldens` seeds + regenerates `.golden.json` sidecars,
and the test runs as part of `make test` (skipping cleanly while the
dir is empty).

What's left: **commit a curated set of 4–6 fixture screenshots**.
That decision was deferred because the maintainer's `screenshots/`
dump (gitignored) contains other players' BattleTags. See
`pkg/parser/testdata/golden/README.md` for the licensing + privacy
considerations.

**Why it's debt.**
Until fixtures are committed, the OCR pipeline — the most failure-
prone part of the codebase — has no end-to-end regression net in
CI. A Tesseract upgrade or image-decoding change can break parsing
without breaking any unit test.

**Mitigation plan.**

1. Pick 4–6 source screenshots covering each detected type (rank,
   summary, personal, scoreboard) plus the in-game scoreboard
   variant and one multi-hero edge case.
2. Crop or blur non-self BattleTags before committing — the parser
   doesn't read them, so blurring is harmless to test signal.
3. Drop the curated PNG files into `pkg/parser/testdata/golden/`.
4. Run `make update-goldens` to seed `.golden.json` sidecars.
5. Eyeball the JSON, commit both.
6. (Optional, only if golden flakes begin) pin Tesseract version in
   CI via `tool-versions.env` and add a per-field tolerance for
   OCR-borderline numeric fields.

**How large.**
S. ~1 hour of curation once the privacy review is done — no code
changes remain on the recall side.

---

## 14. `wails dev` only on macOS — Linux/Windows dev runs serveronly

**Size: L**

**What.**
CLAUDE.md states multiple times: `make dev` is macOS-only; the
devcontainer can't render the Wails GUI; Linux/Windows contributors
use `go run -tags serveronly . --server`.

**Why it's debt.**
The Wails desktop variant is the primary product, but only macOS
contributors can debug its desktop-specific behavior (window chrome,
AssetServer middleware ordering, NSIS installer under wine, etc.).
Cross-platform desktop bugs only surface in CI release builds, where
iteration is slow.

**Mitigation plan.**
This is structural debt, not a quick fix. Two viable options
remain (Option A — server-mode parity audit — was closed in Phase 4
and locked by `pkg/app/screenshots_dir_test.go`):

**Option B (L):** containerize Wails dev with X11/Wayland forwarding.

1. Extend `.devcontainer/devcontainer.json` to mount the host's
   `/tmp/.X11-unix` (Linux) or use XQuartz (macOS host with Linux
   container).
2. Document the setup. Expect breakage on Windows hosts.
3. CI gains nothing from this; only contributor experience does.

**Option C (XL):** drop Wails-specific UI in favor of server-mode
only.

1. The server-mode HTTP variant is mostly feature-complete per
   CLAUDE.md. Could become the only variant, with the desktop
   experience delivered via a thin native shell (Tauri, Electron,
   or just "open a browser pointed at localhost:7000").
2. Substantial product call. Out of scope for tech-debt cleanup.

**How large.**
L if Option B is pursued, XL for Option C. Neither is urgent; the
ongoing maintenance posture is to keep `app_wails.go` /
`app_server.go` the inventory of where the two transports diverge
and audit every new method against parity at merge time.

---

## Prioritized roadmap

Two items remain, ordered by `risk × cost-to-fix-later`:

1. **#12** — fixture commit (S). Cheap once the privacy review clears.
2. **#14** — Wails dev portability (L/XL). Structural; needs product input.

The codebase is in good shape today; none of the above is urgent.
This file exists to make the latent costs visible so they don't
compound silently. When an item lands, **delete its section** — git
history is the audit trail.
