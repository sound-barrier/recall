# Recall — Feature Backlog

A single triage surface for forward-looking feature ideas. Companion
to `TECHNICAL_DEBT.md` (which tracks closed-out engineering work) —
this file tracks the opposite direction: what *could* be built next.

## How this file works

- **Triaging** — unsorted backlog. New ideas land here. No commitment.
- **Accepted** — promoted from Triaging, slated for work. Add a link
  to the issue / PR once one exists.
- **Denied / Won't Do** — explicitly rejected, with a one-line reason.
  Keeping the corpse here is the whole point: future-you (or a future
  contributor) shouldn't re-litigate a decision that was already made.

When an item moves between sections, just edit it in place — git
history is the audit trail. Don't add `~~strikethrough~~` or
`(moved to Accepted)` annotations.

## Triaging

### Analysis & Insights

- **Win rate by time of day / day of week** — surface "you tilt after 11pm" patterns.
- **Tilt detection** — flag long sessions with consecutive losses; optional pop-up nudge to stop.
- **Streak tracking** — current and longest win/loss streaks, per role and overall.
- **Map-specific performance drill-down** — best/worst maps per hero, with sample-size caveats.
- **Hero matchup matrix** — your hero × enemy hero → win rate (requires enemy team capture).
- **Role performance comparison** — tank vs DPS vs support averages side-by-side.
- **Performance trend lines per hero over time** — are you improving on Juno, regressing on Ana?
- **SR / rank velocity** — climb rate per session, week, season.
- **Goal tracking** — "reach Diamond by end of season" with progress bar.

### Match Data & Editing

- **Manual match annotation** — notes, replay code, group members per match.
- **Edit / correct parsed fields in the UI** — override OCR mistakes without re-screenshotting.
- **Bulk re-parse** — re-run a newer parser version across the full screenshot history.
- **Match deletion** — with confirmation, soft-delete first.
- **Match tags** — `stack`, `stream`, `placement`, custom user tags; filterable.

### Ingest & OCR

- **Live OCR while OW is running** — window capture, no manual screenshot needed.
- **Multi-language Tesseract support** — non-English OW clients.
- **Video clip support** — extract end-of-match frames from `.mp4` recordings.
- **Auto-detect screenshots folder on first run** — probe the OW default location.

### UX & Settings

- **Keyboard shortcuts** — `j/k` navigate matches, `/` to focus search, etc.
- **Multiple profiles** — main + alt accounts, separate DBs per profile.
- **Customizable dashboard widgets** — pick which stats appear on the home view.
- **Compact / dense view toggle** — denser match list for high-volume players.

### Integrations

- **Discord webhook** — post match results to a server channel.
- **Twitch / OBS overlay** — current rank, today's W/L, last 5 results.
- **iCal export** — when you played, for "is OW eating my life" reflection.
- **Tracker.gg / Overbuff bulk import** — seed historical data from existing third-party trackers.

### Data & Export

- **CSV / JSON export** — full match history for external analysis.
- **Encrypted SQLite** — passphrase on launch for shared machines.
- **Cloud sync** — S3, Dropbox, or self-hosted endpoint for multi-device players.
- **Local backup / restore** — one-click export of the whole DB to a file.

## Accepted

*Empty.* Move items here from Triaging once they're committed to.
Add issue / PR links inline: `- Feature — short description ([#123](url))`.

## Denied / Won't Do

*Empty.* Move items here when explicitly rejected; append a one-line
reason after an em-dash: `- Feature — Reason: <why>`.
