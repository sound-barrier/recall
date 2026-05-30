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

- **UX & Settings — Matches view as set workspace (PR #100 + #101)** — full redesign of the Matches tab around the *set* as a first-class object. The dossier at the top of the page summarises the current set (W/L/D, winrate, top maps/heroes, active-clause chips); the Campaign Log (heatmap + brushable sparkline via `MatchTimelineHeader` / `MatchHeatmapHeader` / `MatchSparklineBrush`) sits below; compact `.leaf-row` rows fill the rest, each a seven-cell grid (strip / when / map+mode / hero+role / E·A·D / annotations / result chip) that opens the existing right-side detail panel on click. A single left-side **Narrow this set** panel — modal contract identical to the detail panel (focus trap, Esc, backdrop, background `inert` + `aria-hidden`) — replaces the FilterRail's multi-popover with a consolidated filter sheet (search · time scope · map · map type · hero · role · result · tags · leaver handling · dual min-play thresholds · show-unknown toggle). Hero and Map pickers reuse the new `FilterCombobox` (typeahead + selected pills + dropdown listbox; 51 heroes and 31 maps don't fit chip clouds). The Members section above the leaves carries sort + Y/M/W/D group controls. Composables: `useMatchesNarrow` (filter state — 14 refs, derived `narrowedRecords` + `anyNarrow` + `activeClauseCount` + available-option universes; 34 unit tests), `useMatchesGroup` (sort + Monday-anchored Y/M/W/D bucketing; 16 unit tests), `useMatchesDossier` (W/L/D + winrate + top-N maps/heroes; 15 unit tests). `MatchesNarrowState` is parent-owned (`createMatchesNarrowState()` in App.vue) and threaded into both `useMatchesNarrow` and MatchesView so `selection` (the detail panel's selection composable) paginates against the same `narrowedRecords` the view shows — fixes the prev/next + auto-close-on-hide contract that broke when each consumer owned its own copy. Unknown-map matches are hidden by default; soft-deleted records are filtered out unconditionally. 9 e2e cases in `frontend/tests/e2e/matches-set-workspace.spec.ts` cover the dossier headline, panel open/inert, search, `/` shortcut, row→panel drill, group dividers, sort flip, include-unknown, and combobox picks.
- **Match Data & Editing — Manual match annotation** — per-match notes, replay code, group-member chips, a leaver flag (self / ally / enemy), and a tag set (the conventional `stack` / `stream` / `placement` quick-adds plus arbitrary user tags, normalised to lowercase). Edits land in `match_annotations` + `match_annotation_members` + `match_annotation_tags`; surfaced in MatchDetailPanel's body as the Match Journal panel (striped header, dossier-style cells, focus-within accent glow, 900ms saved-pulse on the cell border) and as compact `#tag` / `L` glyphs in the leaf-row's annotations column.
- **Match Data & Editing — Match deletion (soft-delete)** — Hide → Confirm step in `MatchCardDanger.vue` (still mounted inside the detail panel) drops the match from the list and skips it on re-parse, but preserves every per-screenshot row. Unhide flows via the detail panel as well.
- **UX & Settings — Heroes Played collapsibility + Match Journal redesign** — the detail panel's "Heroes Played" block is a clickable chev with a count badge and an in-line summary of the top two heroes (italic Big Noodle + percent) when collapsed. State is local to the panel instance (the panel keys `MatchCardExpanded` by `match_key`, so paginating re-mounts the block in its default-open form). The annotation block was rebuilt as a "Match Journal" panel — striped header strip with a `LOGGED` / `AWAITING ENTRY` status pip, dossier-style cells with accent corner ticks, Replay code + Group on a single 2-column row, and a 900ms cell-border pulse on save.
- **Ingest & OCR — Auto-detect screenshots folder on first run** — `ProbeScreenshotsDir` walks platform-specific OW default paths; Settings → Folders surfaces a "Detect Overwatch Folder" button that applies the probe result.
- **UX & Settings — Min-play threshold filter** — narrow panel's Refinement section lets the user demand a hero played ≥ X% of the match OR ≥ Y minutes (OR semantics) before the match qualifies, useful for filtering out matches where you only briefly swapped to a hero.
- **UX & Settings — Leaver-handling segmented control** — three-state narrow-panel control (`include` / `exclude-tally` / `hide`) for matches the user has flagged as a leaver scenario, so the dossier tally can treat them honestly.
- **UX & Settings — First-day-of-week preference** — Settings → Calendar; threads through `useMatchesGroup` so the "Week of …" labels honor the user's choice.
- **UX & Settings — Theme picker (Day / Night / Contrast)** — Settings → Appearance; three swatch cards with per-swatch palette miniatures (cream paper / black ground / pure-black high-contrast). The Contrast variant boosts the accent to `#ffbf4d`, flattens every surface to pure black, and goes full-saturation on W/L/D colours — built for tournament-booth or low-vision use, never auto-picked. Fresh installs autodetect the OS light/dark preference via `window.matchMedia('(prefers-color-scheme: dark)')` so a user running their OS in light mode lands on Day; once the user explicitly picks anything, `recall.theme` in localStorage takes over and the OS preference is ignored on subsequent launches (and reinstalls — localStorage lives outside the app bundle). `useTheme` composable owns the persistence + DOM apply; `applyTheme` sets `data-theme` on the document root which scopes the CSS variable blocks in `app.css`. Coverage: `frontend/src/composables/useTheme.test.ts` (15 cases including OS-detection branches) and `frontend/tests/e2e/theme.spec.ts` (swatch picks, persistence across reload, OS preference on fresh install, opt-in semantics for Contrast).
- **UX & Settings — Keyboard shortcuts + cheatsheet (`?`)** — power-user bindings exposed by `useKeyboardShortcuts` (single capture-phase document listener, input-gated, sequence-prefix support for vim-style `g`+x view nav). Global: `/` (focus the match-search input), `g`+`m`/`i`/`s`/`u` (view nav), `?` (open the cheatsheet). Matches view: `j`/`k` (card focus, no wrap), `e` (toggle expand), `t` (focus tags editor on the focused card, auto-expanding first). The cheatsheet modal lists every binding the app exposes — including existing tablist arrows + Esc-dismiss + focus-trap Tab cycle — so users discovering one affordance learn about all of them. Composable in `useKeyboardShortcuts.ts`; modal in `KeyboardShortcutsModal.vue`; Playwright e2e in `frontend/tests/e2e/keyboard-shortcuts.spec.ts`.
- **UX & Settings — First-launch onboarding tour** — full-viewport HUD-style briefing overlay that walks new users through configure → parse → explore. Vertical progress rail with ult-charge-style segments on the left, giant Big-Noodle-italic step numbers + accent flares on the right. Gated by the `recall.onboardingCompleted` localStorage key (skip / finish / Escape all persist). Each step's "Next" navigates the underlying tab so the briefing copy and visible view stay synchronised. State + step-machine in `useOnboardingTour`; component in `OnboardingTour.vue`; Playwright e2e in `frontend/tests/e2e/onboarding-tour.spec.ts`.
- **Data & Export — CSV / JSON export** — `ExportData` + `ExportDataCSV` produce full match history dumps; surfaced via Settings → Backup & Restore.
- **Data & Export — Local backup / restore** — one-click DB export + import via Settings → Backup & Restore (`ImportData`), with idempotent re-import semantics.
- **UX & Settings — Right-edge detail panel + screenshot lightbox** — clicking a `.leaf-row` (or pressing `e` on the focused row) opens a 540px-wide slide-in panel from the right anchored to one selected `match_key`. The panel hosts every per-match editor surface (Match Journal, leaver chooser, Match Stats grid, Rank Update — rare/decorated when present, Heroes Played, Source Screenshots, soft-delete row), reordered top-down to read as a scouting dossier: When · Final Score · Parsed (meta strip) → Leaver? → Match Stats → Rank Update → Match Journal → Heroes Played → Sources. Keyboard ergonomics: `← / →` paginate prev/next match against `narrowedRecords` (the same set the leaves list shows; `j`/`k` are vim alternates), `↑ / ↓ / PgUp / PgDn / Space / Home / End` scroll the panel body via an rAF momentum tween, `Esc` closes (capture-phase so a nested cheatsheet or lightbox dismisses just itself; in a text field, Esc blurs the field instead of closing the panel). The panel is a real modal — `useModalFocusTrap` cycles Tab inside `.detail-panel`, `inert` on the background container blocks every Tab / click leak to the leaves list, `/` is suppressed while open. `useSelectedMatch` composable owns the selection + auto-closes when the open match leaves `narrowedRecords` (filter narrows, user hides it). Inline screenshot previews click-to-fullscreen via `MatchScreenshotLightbox`. The cheatsheet (`?`) filters its bindings to the current context (Matches view vs Settings vs panel-open). All three modal surfaces lazy-load via `defineAsyncComponent`. Body assertions live in `MatchDetailPanel.test.ts` (39 cases mounting the panel directly); 25 e2e cases in `frontend/tests/e2e/match-detail-panel.spec.ts` cover open/close/paginate/scroll/Tab-trap/inert/Esc-in-input/section-order/lightbox/cheatsheet/auto-close-on-hide/backdrop-click.

## Retired

Features that shipped and were subsequently removed in a redesign.
Listed here so the design rationale stays discoverable from one
file.

- **UX & Settings — Saved filter presets** (shipped pre-PR-#100; retired in PR #101) — Presets dropdown in the old FilterRail's tools row, backed by `useFilterPresets` + `FilterPresetsMenu.vue`. Deleted alongside the FilterRail itself when the set-workspace redesign moved every filter into the new Narrow this set panel. A typed replacement (serialising `MatchesNarrowState` instead of the legacy snapshot shape) is in `UI_RECOMMENDATIONS.md` as an open item.
- **UX & Settings — Group-jump timeline rail** (shipped; retired in PR #100) — sticky right-edge chip column that scrolled + auto-expanded the target month group on click. The set-workspace redesign replaced the nested Month → Week → Day expand tree with a single sort + Y/M/W/D group control above the leaves; the rail's "jump between many groups" affordance lost its target audience when the tree flattened. Component (`MatchGroupTimeline.vue`) + e2e spec deleted.
- **UX & Settings — Compact / dense view toggle** (shipped; retired in PR #101) — `useDensityMode` composable + a density button in the old group-rail. The new `.leaf-row` design is already as dense as the old compact mode (7-cell grid, monospace numerals, fixed row height) so the toggle had no second mode to flip to.
- **Match Data & Editing — Global match search (vim-style scoped clauses)** (shipped; partially retired in PR #100) — `note:clutch` / `tag:stack` / `member:Apollo` / `replay:7H1` clause parsing via `search-query.ts` + `useMatchFilters.searchClauses`. The new narrow-panel search box does plain substring match across every lexical surface (map / hero / mode / note / tag / heroes-played). The clause-parsing helper still ships and is unit-tested; the UI hook was removed with the FilterRail. Restoring the scoped-clause UX in the narrow panel is open in `UI_RECOMMENDATIONS.md`.

## Denied / Won't Do

- **Encrypted SQLite** — passphrase on launch for shared machines.
- **Cloud sync** — S3, Dropbox, or self-hosted endpoint for multi-device players.
- **Live OCR while OW is running** — window capture, no manual screenshot needed.
- **Discord webhook** — post match results to a server channel.
- **Twitch / OBS overlay** — current rank, today's W/L, last 5 results.
- **Tracker.gg / Overbuff bulk import** — seed historical data from existing third-party trackers.
