# Recall — Feature Backlog

A single triage surface for forward-looking feature ideas. Companion
to `TECHNICAL_DEBT.md` (which tracks closed-out engineering work) —
this file tracks the opposite direction: what *could* be built next.

## How this file works

- **Triaging** — unsorted backlog. New ideas land here. No commitment.
- **Accepted** — promoted from Triaging, slated for work. Add a link
  to the issue / PR once one exists.
- **Shipped** — implemented and on `main`. Kept in the file briefly
  so the backlog reads as a journal of progress; periodically pruned
  (git history is the audit trail).
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
- **Session boundary detection** — auto-group consecutive matches into "sessions" (gaps > 30 min), then surface session-level W/L/avg-stats.
- **Hero pool diversity score** — how many heroes you played in a window, weighted by play-time; flag over-reliance on a single pick.
- **Performance vs SR delta** — does the W/L / E-A-D shape this week actually match the rank change? Highlights "rank deflation" or "lucky climbing."
- **Off-role surprise stat** — when you queue a non-main role, do you over/underperform the role average?
- **Pre / post-patch performance split** — bucket matches by OW patch dates (manually entered or auto-fetched) so you can see "I was good before the Juno nerf."
- **Best-time-of-week heatmap** — calendar grid of W% across hour × day of week (more visual than the "time of day" tally).
- **Fresh-queue vs tilted-queue** — performance after >1h break vs after a <5 min re-queue, side by side.
- **Rolling baseline comparison** — this week's stats vs your own 30-day rolling average (with significance hint when sample is too small).

### Match Data & Editing

- **Edit / correct parsed fields in the UI** — override OCR mistakes without re-screenshotting.
- **Bulk re-parse** — re-run a newer parser version across the full screenshot history.
- **Match tags** — `stack`, `stream`, `placement`, custom user tags; filterable.
- **Pin matches** — pin notable matches (a personal-best, a tournament game) to the top of the list regardless of date.
- **Annotation templates** — copy a match's annotation (group members, replay-code prefix) to another match in one click; useful for stacks playing many matches together.
- **Duplicate-match detector** — flag when two records look like the same match parsed twice from screenshots taken at near-identical timestamps.
- **Manual match merge** — UI to fuse two records into one match-key when correlation didn't catch them automatically.

### Ingest & OCR

- **Multi-language Tesseract support** — non-English OW clients.
- **Video clip support** — extract end-of-match frames from `.mp4` recordings.
- **OCR confidence scoring** — surface low-confidence parses for human review (Tesseract returns per-line confidence; expose it).
- **User-trainable hero-name aliases** — when OCR consistently mangles a specific hero name, let the user save a mapping ("ornBITAL → ORBITAL").
- **Partial-match recovery** — if SUMMARY is missing, attempt match-key derivation from scoreboard + timestamp + map alone, then degrade gracefully.
- **Drag-and-drop screenshot import** — drop a PNG anywhere in the app to ingest it without touching the watcher folder.
- **Background watcher status indicator** — small dot in the masthead showing "watching · N new" so the state is visible from every tab.

### UX & Settings

- **Multiple profiles** — main + alt accounts, separate DBs per profile.
- **Customizable dashboard widgets** — pick which stats appear on the home view.
- **Saved filter presets** — save a filter combination as a named view ("Last 7 days, tank only, undated hidden") in localStorage; recall from a dropdown.
- **Command palette (⌘K)** — fuzzy-find across views, settings, and individual matches by hero/map/date.
- **High-contrast theme** — for streaming / tournament-booth use; sits alongside the existing dark/light/auto toggle.
- **Recent-matches widget on Settings** — small "last 5 matches" strip on the Settings tab so the user always has context while configuring.

### Integrations

- **iCal export** — when you played, for "is OW eating my life" reflection.
- **Bad-streak webhook** — fire a configurable webhook (Discord, Slack, custom) when ≥ N losses in a row, so a friend or `pushover` can intervene.
- **Friend-roster lookup** — match BattleTags in `annotation.members` against a saved roster so the chip shows the friend's display name.
- **Strava-style weekly recap** — generate a shareable weekly-summary image / markdown blob from the session-level stats.

### Data & Export

- **Compressed export bundle** — `.zip` containing the DB + every referenced screenshot, for full-fidelity backups and bug reports.
- **Snapshot diff** — load two export files and report what changed (new matches, hidden matches, annotation edits).
- **Per-season slice** — export only the matches in a specific competitive season for archival.
- **Shareable read-only view** — emit a static HTML bundle of stats (no DB writes possible) suitable for hosting on GitHub Pages.
- **Database integrity check** — surface `PRAGMA integrity_check` in Settings → Advanced so users can verify their DB after a crash.

## Accepted

*Empty.* Move items here from Triaging once they're committed to.
Add issue / PR links inline: `- Feature — short description ([#123](url))`.

## Shipped

Grouped by original Triaging category for cross-reference; no H3 subheads
to avoid heading collisions with the live backlog above.

- **Match Data & Editing — Manual match annotation** — per-match notes, replay code, group-member chips, and a leaver flag (self / ally / enemy). Edits land in `match_annotations` + `match_annotation_members`; surfaced in MatchCard's expanded view and as collapsed `N` / `L` glyphs in the card header.
- **Match Data & Editing — Match deletion (soft-delete)** — Hide → Confirm step in MatchCard's expanded view drops the match from the list and skips it on re-parse, but preserves every per-screenshot row. The FilterRail's `Hidden · N` toggle reveals dimmed cards for review or one-click Unhide.
- **UX & Settings — Group-jump timeline rail** — sticky vertical rail anchored to the right edge of the match list with one spec-plate chip per month group. Suppressed when fewer than two month groups are present (nothing to jump between). Each chip shows an abbreviated label (`May '26`), the total match count for that month, and a leading pip that fills with accent when the month is the one currently in view. Clicking a chip auto-expands the target group's ancestor chain (so the user lands on content, not a closed chevron), smooth-scrolls the section to the viewport with `scrollIntoView({ block: 'start' })`, and runs a brief `target-acquired` flash on the group head so the destination is unmistakable. An `IntersectionObserver` with a narrow `rootMargin` of `-20% 0px -55% 0px` tracks which month occupies the user's primary reading line and lifts the corresponding chip's active treatment (accent border + `-3px` translateX + `aria-current="location"`) as they scroll. The chip itself eagerly takes the active state on click — `scrollIntoView` clamps to `maxScroll` on short pages, and without the eager update the observer would never elect the target and the rail would look unresponsive. Honors `prefers-reduced-motion` (no smooth scroll, no transform animations, but the active-marker swap stays so the state change is still readable). Hidden under 1180px viewport — the chip column collides with card content on narrower layouts and the user has the group headers right there to click. Component in `MatchGroupTimeline.vue`; jump handler + ancestor-expand walk + flash in `MatchesView.onJumpToGroup`; flash keyframes attached to the outer `.mg` in `MatchGroupSection.vue`. Coverage: `frontend/tests/e2e/group-timeline.spec.ts` (chip rendering, single-month suppression, scroll + expand, aria-current update).
- **Match Data & Editing — Global match search (vim-style)** — free-text input in the FilterRail's filter-bar accepts a vim/less-style query that searches across every annotation field. Two clause shapes:
  - **Bare token** (e.g. `clutch`) — substring-matches anywhere in `annotation.note`, `replay_code`, members, OR tags.
  - **Field-scoped** (e.g. `note:clutch`, `replay:7H1`, `member:Apollo`, `tag:stack`) — restricts to that single field. Plural aliases (`notes:`, `tags:`, …) collapse to the canonical singular. Unknown field prefixes fall through as bare text.
  Multiple clauses AND together. Quoted values (`note:"huge clutch"`) preserve internal whitespace. Case-insensitive throughout. Parsing is a pure helper in `frontend/src/search-query.ts` (with Vitest coverage); `useMatchFilters` consumes the parsed clause list and runs each filter test in O(clauses × fields). The input itself carries a leading `/` glyph that visually echoes the keyboard shortcut, mono font, accent focus-glow; parsed clauses surface below the input as spec-plate chips (scoped clauses carry their field label in accent and a solid border; bare clauses get an ANY label with a dashed border) — each chip has a × that drops just that clause from the raw query while preserving the rest. `/` focuses the input from anywhere; clearing happens via the inline × button or by removing the matching active-filter pill. Expanded match cards render any clause that targets the note (scoped `note:` OR bare) as `<mark class="note-hit">` runs in the click-to-edit preview, layered via the new n-term `highlightSubstrings` helper. Source files: `search-query.ts`, `useMatchFilters.ts`, `FilterRail.vue`, `MatchCardExpanded.vue`, `MatchesFilterPills.vue`. Coverage: `frontend/tests/e2e/match-search.spec.ts` (clause shapes + AND + quoting + clause-chip rendering) and `match-notes-search.spec.ts` (hit-highlighting + click-to-edit cycle).
- **Ingest & OCR — Auto-detect screenshots folder on first run** — `ProbeScreenshotsDir` walks platform-specific OW default paths; Settings → Folders surfaces a "Detect Overwatch Folder" button that applies the probe result.
- **UX & Settings — Compact / dense view toggle** — `useDensityMode` composable + group-rail toggle; compact mode tightens MatchCard padding and inlines E/A/D + damage on the card header.
- **UX & Settings — Min-play threshold filter** — FilterRail input lets the user demand a hero played ≥ X% of the match or ≥ Y minutes before the match qualifies, useful for filtering out matches where you only briefly swapped to a hero.
- **UX & Settings — Leaver-handling segmented control** — three-state FilterRail control (`include` / `exclude-tally` / `hide`) for matches the user has flagged as a leaver scenario, so the tally panel can treat them honestly.
- **UX & Settings — First-day-of-week preference** — Settings → Calendar; threads through `useMatchGrouping` so the "Week of …" labels honor the user's choice.
- **UX & Settings — Theme toggle (dark / light / auto)** — Settings → Appearance; `useTheme` composable persists the choice and applies `data-theme` to the document root.
- **UX & Settings — Keyboard shortcuts + cheatsheet (`?`)** — power-user bindings exposed by `useKeyboardShortcuts` (single capture-phase document listener, input-gated, sequence-prefix support for vim-style `g`+x view nav). Global: `/` (focus the match-search input), `g`+`m`/`i`/`s`/`u` (view nav), `?` (open the cheatsheet). Matches view: `j`/`k` (card focus, no wrap), `e` (toggle expand), `t` (focus tags editor on the focused card, auto-expanding first). The cheatsheet modal lists every binding the app exposes — including existing tablist arrows + Esc-dismiss + focus-trap Tab cycle — so users discovering one affordance learn about all of them. Composable in `useKeyboardShortcuts.ts`; modal in `KeyboardShortcutsModal.vue`; Playwright e2e in `frontend/tests/e2e/keyboard-shortcuts.spec.ts`.
- **UX & Settings — First-launch onboarding tour** — full-viewport HUD-style briefing overlay that walks new users through configure → parse → explore. Vertical progress rail with ult-charge-style segments on the left, giant Big-Noodle-italic step numbers + accent flares on the right. Gated by the `recall.onboardingCompleted` localStorage key (skip / finish / Escape all persist). Each step's "Next" navigates the underlying tab so the briefing copy and visible view stay synchronised. State + step-machine in `useOnboardingTour`; component in `OnboardingTour.vue`; Playwright e2e in `frontend/tests/e2e/onboarding-tour.spec.ts`.
- **Data & Export — CSV / JSON export** — `ExportData` + `ExportDataCSV` produce full match history dumps; surfaced via Settings → Backup & Restore.
- **Data & Export — Local backup / restore** — one-click DB export + import via Settings → Backup & Restore (`ImportData`), with idempotent re-import semantics.

## Denied / Won't Do

- **Encrypted SQLite** — passphrase on launch for shared machines.
- **Cloud sync** — S3, Dropbox, or self-hosted endpoint for multi-device players.
- **Live OCR while OW is running** — window capture, no manual screenshot needed.
- **Discord webhook** — post match results to a server channel.
- **Twitch / OBS overlay** — current rank, today's W/L, last 5 results.
- **Tracker.gg / Overbuff bulk import** — seed historical data from existing third-party trackers.
