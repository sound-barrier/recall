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

- **Win rate by time of day / day of week** — surface "you tilt after 11pm" patterns. Surfaces as a 7×24 mini-heatmap on the Settings → Insights tab; cell tooltip carries match-count + significance hint.
- **Tilt detection** — flag long sessions with consecutive losses; optional pop-up nudge to stop. Two-pronged trigger: ≥3 losses in a row AND the rolling-window K/D dropped >25% from the user's 30-day average. Nudge is dismissible without persistence (so it doesn't moralise on a single bad day).
- **Streak tracking** — current and longest win/loss streaks, per role and overall. Streak panel beside the W/L tally on the AggregateStats surface.
- **Map-specific performance drill-down** — best/worst maps per hero, with sample-size caveats. Confidence interval rather than raw win-rate (`62% ± 8%, n=14`) so a 100% streak on n=2 doesn't dominate.
- **Hero matchup matrix** — your hero × enemy hero → win rate (requires enemy team capture, which is a parser stretch).
- **Role performance comparison** — tank vs DPS vs support averages side-by-side.
- **Performance trend lines per hero over time** — are you improving on Juno, regressing on Ana? Mini-sparkline beside the hero name inside the journal/expanded card.
- **SR / rank velocity** — climb rate per session, week, season.
- **Goal tracking** — "reach Diamond by end of season" with progress bar.
- **Session boundary detection** — auto-group consecutive matches into "sessions" (gaps > 30 min), then surface session-level W/L/avg-stats. Visual divider in the match list when the gap to the previous match exceeds the threshold; session header shows "Session · 4 matches · 75% WR · ~52 min".
- **Hero pool diversity score** — how many heroes you played in a window, weighted by play-time; flag over-reliance on a single pick.
- **Performance vs SR delta** — does the W/L / E-A-D shape this week actually match the rank change? Highlights "rank deflation" or "lucky climbing."
- **Off-role surprise stat** — when you queue a non-main role, do you over/underperform the role average?
- **Pre / post-patch performance split** — bucket matches by OW patch dates (manually entered or auto-fetched) so you can see "I was good before the Juno nerf."
- **Fresh-queue vs tilted-queue** — performance after >1h break vs after a <5 min re-queue, side by side.
- **Rolling baseline comparison** — this week's stats vs your own 30-day rolling average (with significance hint when sample is too small). Significance check: t-test on the mean difference; show `↑ +1.4σ` style annotation rather than a raw percentage delta.
- **Form chart** — small W/L/W/W/L sparkline of the last 10 matches per role, refreshed live as new matches parse. Same dimensions as the existing slot-chip family so it lives in the masthead header band without disturbing the layout.
- **Annual recap** — Spotify-style year-end review: total hours, most-played hero, peak SR, best W-streak, longest losing skid, "you played Juno on Rialto N times". Generated as a single shareable image (PNG) via an offscreen canvas + the existing Big Noodle font.

### Match Data & Editing

- **Edit / correct parsed fields in the UI** — override OCR mistakes without re-screenshotting. Inline pencil affordance on each stat cell; PATCH to a typed-sentinel-validated `/api/v1/matches/{matchKey}/overrides` endpoint that layers on top of the per-screenshot rows at aggregate time without mutating the parse history.
- **Bulk re-parse** — re-run a newer parser version across the full screenshot history. Progress UI mirrors the existing `ParseStatusBar`; per-file delta visible (`old → new` numeric change) so the user knows what actually moved.
- **Pin matches** — pin notable matches (a personal-best, a tournament game) to the top of the list regardless of date. Use a star (`★`) on the card header — single click toggles. Pinned matches form their own group above the date-grouped list, with its own count.
- **Annotation templates** — copy a match's annotation (group members, replay-code prefix, tag set) to another match in one click; useful for stacks playing many matches together. "Apply previous annotation" button on the journal panel head, populates the draft state but waits for confirmation before persisting.
- **Duplicate-match detector** — flag when two records look like the same match parsed twice from screenshots taken at near-identical timestamps. Suggest merge or hide on the second occurrence; add a `data-duplicate-of` link in the card chrome for navigation.
- **Manual match merge** — UI to fuse two records into one match-key when correlation didn't catch them automatically. Drag one card onto another (with a hover-state confirm zone) to invoke; the merged row's match_key is the older of the two.
- **Match exclusion reasons** — annotation field for *why* a match is being de-emphasised (placement / MMR adjustment / DC / internet outage). Drives a filter that hides them from win-rate calculations without removing them from the list, complementing the existing leaver-handling control.
- **Per-match audit log** — every annotation edit / leaver flag / hide-toggle timestamped + recoverable in Settings → Advanced. Useful for "did I mistakenly hide this one last month?" recovery; storage is a single appended row per change, capped to N most-recent edits.

### Ingest & OCR

- **Multi-language Tesseract support** — non-English OW clients. `pkg/parser/tesseract.go` invokes Tesseract with `-l eng`; replace with the user's configured language code from `Settings → Engine`. Hero/map roster dictionaries (`heroes.yaml`, `maps.yaml`) become localisation-aware: each entry has a `display_name` map keyed by locale plus the canonical English token used for storage.
- **Video clip support** — extract end-of-match frames from `.mp4` recordings using `ffmpeg`. Frame-selection heuristic: every 0.5s, classify; once the classifier hits SUMMARY/TEAMS/PERSONAL, capture that exact frame and feed to the existing OCR pipeline.
- **OCR confidence scoring** — surface low-confidence parses for human review (Tesseract returns per-line `--c=stderr` confidence; expose it). Stat cells under a configurable threshold get a subtle dashed underline + tooltip; aggregated into a per-match "confidence score" surfaced as a chip on the card.
- **User-trainable hero-name aliases** — when OCR consistently mangles a specific hero name, let the user save a mapping (`ornBITAL → ORBITAL`). Lives in `pkg/parser/aliases.yaml` (gitignored, user-local); applied by the classifier before hero-roster lookup.
- **Partial-match recovery** — if SUMMARY is missing, attempt match-key derivation from scoreboard + timestamp + map alone, then degrade gracefully. Reuses the existing EAD-signature matching in `resolveMatchKey`; surfaces under a "partial" badge on the card so the user knows this match has incomplete data.
- **Drag-and-drop screenshot import** — drop a PNG anywhere in the app to ingest it without touching the watcher folder. HTML5 file API on the Matches view's outer dropzone; bypasses the watcher and writes directly into the configured screenshots dir under a `manual/` subdir.
- **Background watcher status indicator** — small dot in the masthead showing "watching · N new" so the state is visible from every tab. Two states: idle (dim green) and processing (pulsing accent); tooltip surfaces the most recent activity timestamp.
- **Screenshot content-hash dedup** — SHA-256 the file content at ingest; if a hash matches an already-parsed file, skip Tesseract entirely and link the rows. Catches "saved the same screenshot twice via Steam + system shortcut" cases without re-OCR cost.
- **Watcher pause when game not running** — detect OW process / active window via OS APIs (macOS `NSWorkspace`, Windows `EnumWindows`, Linux `wmctrl`); pause the file-watcher when OW isn't running so a system sleep+wake doesn't re-scan everything. Single boolean preference in Settings → Engine.
- **OCR debug overlay** — toggle "show raw Tesseract output" on each card to compare the parsed values against the raw text. Useful for filing OCR bugs; surfaces under Settings → Advanced.

### UX & Settings

- **Multiple profiles** — main + alt accounts, separate DBs per profile. Switcher chip in the masthead; each profile gets its own `RECALL_DATA_DIR` subdir. `--profile=<name>` CLI flag for the server-mode binary to scope a single launch.
- **Customizable dashboard widgets** — pick which stats appear on the home view. Drag-to-reorder card list of widgets; each widget is a self-contained `<DashboardWidget>` SFC with a fixed grid footprint so the layout stays tractable.
- **Command palette (⌘K)** — fuzzy-find across views, settings, and individual matches by hero/map/date. Modal overlay with the same scoring engine as the existing match-search parser; live preview surfaces the top 5 results as the user types.
- **Recent-matches widget on Settings** — small "last 5 matches" strip on the Settings tab so the user always has context while configuring.
- **Natural-language date picker** — `last week`, `this season`, `before Mauga buff`, `since Tuesday` parses to date ranges and pre-fills the date filter. Falls back to the existing datetime pickers for ambiguous input.
- **Live ranked progress tracker** — sticky banner during a session showing W/L count + estimated SR delta + remaining matches needed to hit the next rank tier. Activates when the user has parsed ≥3 matches within a 90-minute window.
- **Inline image preview on Unknown** — hover an entry in the Unknown Maps view for a small thumbnail without click. Pairs with the existing click-to-expand preview so triage gets faster.
- **Multi-window support** — open the Matches view in a separate Wails window while parsing continues in the main window. Per-window state (filters, focused card) but shared records.
- **Quick-edit popover on stat cells** — click any displayed stat on a card → 1-click ± nudge or numeric input without expanding the whole card. Useful for correcting OCR mistakes without opening the journal.
- **Onboarding skip-ahead** — let the user skip directly to a specific step from the tour, instead of forcing the linear order. Side-rail chips become clickable jump points.
- **Animated skeleton loaders** — replace the spinner with skeleton cards on first paint when records are still being fetched, so the layout doesn't pop into place a beat after the masthead settles.
- **Settings export/import** — share configuration with a teammate (folder paths, theme, filter prefs, presets) as a small JSON. Useful for stack-mate parity; lives next to the existing Backup & Restore section.
- **Match journal writing mode** — dedicated full-viewport markdown editor for the note field, with side-rail preview + word count. Reached via a small "expand" affordance on the journal panel; submission persists back through `SetMatchAnnotation`.

### Integrations

- **iCal export** — when you played, for "is OW eating my life" reflection. Generates a `.ics` file from session-grouped matches; each session becomes a single event with the W/L tally in the description.
- **Bad-streak webhook** — fire a configurable webhook (Discord, Slack, custom) when ≥ N losses in a row, so a friend or `pushover` can intervene. The webhook URL is per-user secret — store in `settings.json` but flag in the export to redact.
- **Friend-roster lookup** — match BattleTags in `annotation.members` against a saved roster so the chip shows the friend's display name. Roster file is YAML at `~/.config/recall/roster.yaml`, optionally synced via the Backup & Restore export.
- **Strava-style weekly recap** — generate a shareable weekly-summary image / markdown blob from the session-level stats. Hooks the existing `tallyWLD` aggregator + a server-side PNG render via `chromedp`.
- **Markdown export per match** — single-match summary as markdown for blog posts / coaching review. Three-section template: scoreboard table, journal annotation rendered as markdown, embedded source-screenshot file references.
- **OBS scene switcher** — switch OBS scenes via the OBS WebSocket protocol when a SUMMARY screenshot is detected. Use case: streamers running a "between matches" scene that flips to "match in progress" the moment the parser sees a non-summary screenshot.
- **Replay-code QR code** — generate a QR encoding the replay code for sharing with a coach via phone scan. Pure SVG, no external service.
- **Match → calendar event** — auto-create a system calendar event for "OW match" with the result + length so habit-tracker apps see it. Uses macOS EventKit / Windows Outlook / Linux CalDAV, gated behind explicit permission.

### Data & Export

- **Compressed export bundle** — `.zip` containing the DB + every referenced screenshot, for full-fidelity backups and bug reports. Manifest at the root lists screenshot file ↔ match_key mapping for sanity-checking after restore.
- **Snapshot diff** — load two export files and report what changed (new matches, hidden matches, annotation edits). Three-pane diff view: added / removed / edited; uses the existing `MatchRecord` equality semantics.
- **Per-season slice** — export only the matches in a specific competitive season for archival. Season boundaries auto-detected from rank screens; manual override per export.
- **Shareable read-only view** — emit a static HTML bundle of stats (no DB writes possible) suitable for hosting on GitHub Pages. Re-uses the existing Vite build via a "no-server" entry point that swaps the `fetch`-based api.ts for a static JSON bundle inlined into the HTML.
- **Database integrity check** — surface `PRAGMA integrity_check` in Settings → Advanced so users can verify their DB after a crash. Pair with a `PRAGMA optimize` button for the same surface.
- **Cross-device sync via export** — explicit "Snapshot for transfer" button creating a timestamped JSON for moving the DB to a new machine. Bundles the screenshots dir reference too so the new install knows where to pick up watching.
- **Read-only / archival mode** — Settings → Advanced toggle that freezes writes (no parses, no edits) for long-term archival use. Useful for retired alt accounts; visible state in the masthead as a "READ ONLY" badge.

### Performance & Robustness

- **Background parse queue visualisation** — explicit "12 / 47 files" progress in the masthead or status bar, replacing the current "parallelism is happening behind the curtain" feel. Drives off the existing `parse-progress` SSE event; doesn't require new server endpoints.
- **Memory / DB profiler in Advanced** — show on-disk DB size, per-table row counts, aggregator allocation, parse queue depth. Helps the user understand why a 10k-match history feels slow before they file a perf bug.
- **Schema verifier in Settings** — Advanced tool that walks every parent + child table, compares column shapes against the canonical CREATE TABLE in `pkg/db/db.go`, and reports drift. Catches "I hand-edited the DB and now things look weird" cases.
- **Resilient parse with retry** — auto-retry failed Tesseract calls (single-screenshot transient I/O failures) with exponential backoff before marking the file unknown. Failures lifted out of the screenshot's exec context so the rest of the parse loop continues.
- **Parser benchmarks dashboard** — Settings tool that times each per-type parser against the bundled golden fixtures and surfaces a regression flag if any path slows >25% versus baseline. Pairs with the existing `make test` golden-file run.
- **Vacuum scheduler** — auto-run `PRAGMA optimize` after every N parse cycles, with a manual "Vacuum now" button in Advanced. Keeps the DB compact without requiring user intervention.

## Accepted

*Empty.* Move items here from Triaging once they're committed to.
Add issue / PR links inline: `- Feature — short description ([#123](url))`.

## Shipped

Grouped by original Triaging category for cross-reference; no H3 subheads
to avoid heading collisions with the live backlog above.

- **Match Data & Editing — Manual match annotation** — per-match notes, replay code, group-member chips, a leaver flag (self / ally / enemy), and a tag set (the conventional `stack` / `stream` / `placement` quick-adds plus arbitrary user tags, normalised to lowercase). Edits land in `match_annotations` + `match_annotation_members` + `match_annotation_tags`; surfaced in MatchCard's expanded view as the Match Journal panel (striped header, dossier-style cells, focus-within accent glow, 900ms saved-pulse on the cell border) and as collapsed glyphs in the card header (`N` notes, `L` leavers, `T` tags).
- **Match Data & Editing — Match deletion (soft-delete)** — Hide → Confirm step in MatchCard's expanded view drops the match from the list and skips it on re-parse, but preserves every per-screenshot row. The FilterRail's `Hidden · N` toggle reveals dimmed cards for review or one-click Unhide.
- **UX & Settings — Saved filter presets** — Presets dropdown in the FilterRail's tools row. Stores named filter combinations (every multi-select array + note query + date range + sort + min-play threshold + leaver mode + show-hidden) as JSON in localStorage; serialises via a defensive `parsePresetSnapshot` that drops unknown keys, so hand-edited values can't crash the parser. Save-current prompts for a name; per-preset apply / delete; persistence survives reinstalls because localStorage lives outside the app bundle on every supported platform. Component in `FilterPresetsMenu.vue`; composable in `useFilterPresets.ts`; coverage in `frontend/tests/e2e/filter-presets.spec.ts`.
- **UX & Settings — Heroes Played collapsibility + Match Journal redesign** — the expanded match-card's "Heroes Played" block is now a clickable chev with a count badge and an in-line summary of the top two heroes (italic Big Noodle + percent) when collapsed. State is local to the card instance (defaults expanded each time a match is opened in the detail panel — the panel keys `MatchCardExpanded` by `match_key`, so paginating re-mounts the block in its default-open form; the global-persistence model was retired with the detail panel). The annotation block was rebuilt as a "Match Journal" panel — striped header strip with a `LOGGED` / `AWAITING ENTRY` status pip, dossier-style cells with accent corner ticks, Replay code + Group on a single 2-column row to reclaim vertical space, and a 900ms cell-border pulse on save instead of a 3rd grid column for `saved ✓`.
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
- **UX & Settings — Theme picker (Day / Night / Contrast)** — Settings → Appearance; three swatch cards with per-swatch palette miniatures (cream paper / black ground / pure-black high-contrast). The Contrast variant boosts the accent to `#ffbf4d`, flattens every surface to pure black, and goes full-saturation on W/L/D colours — built for tournament-booth or low-vision use, never auto-picked. Fresh installs autodetect the OS light/dark preference via `window.matchMedia('(prefers-color-scheme: dark)')` so a user running their OS in light mode lands on Day; once the user explicitly picks anything, `recall.theme` in localStorage takes over and the OS preference is ignored on subsequent launches (and reinstalls — localStorage lives outside the app bundle). `useTheme` composable owns the persistence + DOM apply; `applyTheme` sets `data-theme` on the document root which scopes the CSS variable blocks in `app.css`. Coverage: `frontend/src/composables/useTheme.test.ts` (15 cases including OS-detection branches) and `frontend/tests/e2e/theme.spec.ts` (swatch picks, persistence across reload, OS preference on fresh install, opt-in semantics for Contrast).
- **UX & Settings — Keyboard shortcuts + cheatsheet (`?`)** — power-user bindings exposed by `useKeyboardShortcuts` (single capture-phase document listener, input-gated, sequence-prefix support for vim-style `g`+x view nav). Global: `/` (focus the match-search input), `g`+`m`/`i`/`s`/`u` (view nav), `?` (open the cheatsheet). Matches view: `j`/`k` (card focus, no wrap), `e` (toggle expand), `t` (focus tags editor on the focused card, auto-expanding first). The cheatsheet modal lists every binding the app exposes — including existing tablist arrows + Esc-dismiss + focus-trap Tab cycle — so users discovering one affordance learn about all of them. Composable in `useKeyboardShortcuts.ts`; modal in `KeyboardShortcutsModal.vue`; Playwright e2e in `frontend/tests/e2e/keyboard-shortcuts.spec.ts`.
- **UX & Settings — First-launch onboarding tour** — full-viewport HUD-style briefing overlay that walks new users through configure → parse → explore. Vertical progress rail with ult-charge-style segments on the left, giant Big-Noodle-italic step numbers + accent flares on the right. Gated by the `recall.onboardingCompleted` localStorage key (skip / finish / Escape all persist). Each step's "Next" navigates the underlying tab so the briefing copy and visible view stay synchronised. State + step-machine in `useOnboardingTour`; component in `OnboardingTour.vue`; Playwright e2e in `frontend/tests/e2e/onboarding-tour.spec.ts`.
- **Data & Export — CSV / JSON export** — `ExportData` + `ExportDataCSV` produce full match history dumps; surfaced via Settings → Backup & Restore.
- **Data & Export — Local backup / restore** — one-click DB export + import via Settings → Backup & Restore (`ImportData`), with idempotent re-import semantics.
- **UX & Settings — Right-edge detail panel + screenshot lightbox** — clicking a match card (or pressing `e` on the focused row) opens a 540px-wide slide-in panel from the right anchored to one selected `match_key`. Replaces the inline-expansion model so deep inspection doesn't fight for vertical space with the underlying list. The panel hosts the same editor surfaces as the old expanded card (Match Journal, leaver chooser, Match Stats grid, Rank Update — rare/decorated when present, Heroes Played, Source Screenshots, soft-delete row), reordered top-down to read as a scouting dossier: When · Final Score · Parsed (meta strip) → Leaver? → Match Stats → Rank Update → Match Journal → Heroes Played → Sources. Keyboard ergonomics: `← / →` paginate prev/next match (timeline metaphor; `j`/`k` are vim alternates), `↑ / ↓ / PgUp / PgDn / Space / Home / End` scroll the panel body via an rAF momentum tween (continuous glide on key-hold; CSS `scroll-behavior: smooth` cancels-and-restarts on each press and felt jittery), `Esc` closes (capture-phase so a nested cheatsheet or lightbox dismisses just itself; in a text field, Esc blurs the field instead of closing the panel). The panel is a real modal — `useModalFocusTrap` cycles Tab inside `.detail-panel`, `inert` on the background container blocks every Tab / click leak to the FilterRail or matches list, `/` is suppressed while open. `useSelectedMatch` composable owns the selection + auto-closes when the open match leaves `filteredSorted` (filter narrows, user hides it). Inline screenshot previews now click-to-fullscreen via `MatchScreenshotLightbox` — backdrop click / × button / Esc all close, capture-phase Esc means the lightbox dismisses only itself if the panel is also open. The cheatsheet (`?`) now filters its bindings to the current context (Matches view vs Settings vs panel-open — non-relevant groups drop out), swallows every key except `j`/`↑` (scroll up), `k`/`↓` (scroll down), `Esc` (close), and Tab (focus trap). All three modal surfaces lazy-load via `defineAsyncComponent` so they stay out of the initial JS chunk. Components in `MatchDetailPanel.vue`, `MatchScreenshotLightbox.vue`, plus the rebuilt `KeyboardShortcutsModal.vue`; composables in `useSelectedMatch.ts` (+ unit tests); `useModalFocusTrap` gained `preventScroll: true` so the cheatsheet opens scrolled to the top rather than auto-scrolling to its only focusable; `useKeyboardShortcuts` gained an optional `suppressed` ref so the global dispatcher bows out wholesale while the cheatsheet is up. Body assertions live in `MatchDetailPanel.test.ts` (39 cases mounting the panel directly); 22 e2e cases in `frontend/tests/e2e/match-detail-panel.spec.ts` cover open/close/paginate/scroll/Tab-trap/inert/Esc-in-input/section-order/lightbox/cheatsheet/auto-close/backdrop-click.

## Denied / Won't Do

- **Encrypted SQLite** — passphrase on launch for shared machines.
- **Cloud sync** — S3, Dropbox, or self-hosted endpoint for multi-device players.
- **Live OCR while OW is running** — window capture, no manual screenshot needed.
- **Discord webhook** — post match results to a server channel.
- **Twitch / OBS overlay** — current rank, today's W/L, last 5 results.
- **Tracker.gg / Overbuff bulk import** — seed historical data from existing third-party trackers.
