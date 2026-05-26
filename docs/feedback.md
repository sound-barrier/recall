# Bug reports & feature requests

Recall is maintained in spare time and given away free. Every report
helps prioritise what gets fixed next. There are three channels,
depending on what you want to file.

## Found a bug

Open a **Bug report** issue:

[**→ File a bug report**](https://github.com/sound-barrier/recall/issues/new?template=bug_report.yml)

The template walks you through the fields the maintainer needs to
reproduce the problem:

- **Recall version** — shown in the top-right of the app (e.g.
  `v0.1.0`), or run `recall-server --version` for the server binary.
- **Operating system + version** — `macOS 15.2`, `Ubuntu 24.04`,
  `Windows 11 23H2`, etc.
- **Tesseract version** — shown in **Settings → Engine**, or run
  `tesseract --version`.
- **Expected vs actual** — what you thought would happen, what
  actually happened.
- **Steps to reproduce** — a short numbered list.
- **Screenshots** — drag images directly into the form. Two fields:
  - **The Overwatch screenshot that mis-parsed** (if the bug is "Recall
    read the wrong stat from this match"). Every parser bug is many
    times easier to fix when the source PNG is attached.
  - **The Recall app or website screenshot** showing what looked wrong
    (UI glitch, missing data, weird filter behavior, etc.).
- **Logs** — terminal output for the server, or the **Parse** tab's
  progress panel for the desktop app.

Skip a field with `n/a` if it doesn't apply.

## Want a feature

Open a **Feature request** issue:

[**→ File a feature request**](https://github.com/sound-barrier/recall/issues/new?template=feature_request.yml)

The template asks for:

- **What you'd like Recall to do** — one paragraph.
- **Why** — what problem this solves for you, or what insight from
  match history it would unlock.
- **How you'd use it** — a concrete workflow ("after every comp
  session I'd want to…"). Helps the maintainer judge whether the
  feature fits the existing UI vs. needs its own surface.
- **Alternatives you've considered** — workarounds that almost work,
  competing tools, etc. Helps avoid re-litigating decided trade-offs.
- **Mockups / screenshots** — optional, but a sketch / wireframe of
  what you imagine usually shortens the design discussion by half.

Feature requests don't carry an SLA — the project is given away free
with no demand on the maintainer's time. But they DO get read, and
real-user workflows are how the next-most-useful thing to build gets
identified.

## Security issue

**Do not open a public issue for a security bug.** File a private
advisory instead:

[**→ Report a security vulnerability**](https://github.com/sound-barrier/recall/security/advisories/new)

[`SECURITY.md`](https://github.com/sound-barrier/recall/blob/main/SECURITY.md)
covers the disclosure policy, the supported-version policy (only the
latest release), and what's in/out of scope.

## What gets answered first

Triage priority, in rough order:

1. Security advisories (private channel above).
2. Reproducible bugs with clear repro steps + version info.
3. Bugs that are missing the version or steps — the maintainer will
   ask, and the clock starts again when you respond.
4. Feature requests with a clear "why" and concrete usage description.
5. Open-ended "would be nice if…" comments.

If you're not sure whether something is a bug or a feature, file it
as a bug — the templates differ in their checklists but both end up
in the same triage queue, and re-labeling is cheap.
