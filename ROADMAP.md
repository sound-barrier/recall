# Recall Roadmap

Forward-looking design decisions and unfinished work for surfaces
that have moved past the backlog (`FEATURES.md`) but aren't all the
way done. The two surfaces tracked here today are:

- **Analysis tab** — new analytics-first dashboard (described
  below). Sketch in place, real composables to come.
- **Matches tab redesign** — preserve the per-match drill-down +
  set-of-matches drill-down behaviours while reorganising the page
  around them. Direction TBD; will be added to this file when
  picked.

The first item is the original purpose of this doc; the second is
why the file was promoted from `DASHBOARD.md` to a broader roadmap.

---

## Analysis tab

This section is the design north star for the new **Analysis** tab
— a parallel surface to the existing **Matches** tab. The two
coexist:

- **Matches** stays the way it is — a chronological log with the
  FilterRail, the match cards, the detail panel + lightbox the user
  built. The audience there is "I want to look at *this match*."
- **Analysis** is new — an analytics-first coaching dashboard
  optimised for *finding patterns over time* in the player's own
  play and using those patterns to improve. Historical
  record-keeping is the secondary outcome there.

The Analysis tab does **not** replace Matches. It reads the same
records, and any "drill into a match" action in Analysis opens the
same detail panel + lightbox plumbing that ships on Matches, so the
per-match deep-inspection work is reused, not forked.

## Phases

| Phase | Status | Outcome |
|---|---|---|
| **E — Analytics-first Analysis tab** | In progress | Build the new Analysis tab as a chart grid. KPIs + time-series + breakdowns + the Campaign Log heatmap. A drill-down drawer drops into the existing detail panel for per-match inspection. The scope bar replaces a per-page FilterRail. |
| **F — Coaching insight cards** | Planned (this doc) | Pair each chart with a rule-based observation card that calls out what's worth looking at. Cards are the *coach*; charts are the *evidence*. |
| **G — Statistical / ML** | Future, out of scope for now | Anomaly detection, forecasting, LLM-narrated insights, curated coaching playlists. |

Phase G is intentionally not specified here — once F lands and real
players use it, the gaps will reveal themselves.

---

## Phase F: Coaching insight cards

### Concept

Each insight card surfaces a **single observation about the player's
play** in plain language:

> "Your Lúcio winrate dropped from 65 % → 48 % over the last 30 days
> (n = 22). It's worst on Volskaya (1 W / 5 L)."

A card has three jobs:

1. **Point at a pattern** the player would otherwise have to spot by
   eyeballing charts.
2. **Anchor on the supporting chart** so the claim is verifiable in
   the same screen.
3. **Drill down to matches** — every card has a "view these N
   matches" link that opens the match-list drawer scoped to the
   relevant slice.

Cards are not nags; they are bookmarks for "this might be worth a
look." A card without action is a card we shouldn't have surfaced.

### Architecture

```text
                       ┌─────────────────────────────┐
records ──filter──────►│   useMatchInsights(scope)   │
                       │                             │
                       │  ┌───────────────────────┐  │
                       │  │ rule 1 ──► InsightCard│  │
                       │  │ rule 2 ──► InsightCard│  │
                       │  │ rule 3 ──► null       │  │
                       │  │ ...                   │  │
                       │  └───────────────────────┘  │
                       │  ┌───────────────────────┐  │
                       │  │ significance gate     │  │
                       │  │ top-K ranking         │  │
                       │  └───────────────────────┘  │
                       └────────────┬────────────────┘
                                    │
                                    ▼
                         ┌───────────────────────┐
                         │ InsightCard[] →  UI   │
                         └───────────────────────┘
```

- **`useMatchInsights(records, scope)`** — composable. Returns
  `Ref<InsightCard[]>`.
- **Rules are pure functions**: `(records, scope) => InsightCard |
  null`. Each rule owns its own threshold + significance check. No
  shared state.
- **Card shape** (proposed):

  ```ts
  interface InsightCard {
    id: string                 // stable id for dismiss persistence
    severity: 'positive' | 'neutral' | 'concern'
    title: string              // short headline ("Lúcio winrate drift")
    narrative: string          // plain-language sentence
    sampleSize: number
    confidence: number         // 0..1 — surfacing threshold
    anchor: {
      chart: string            // 'winrate-trend' / 'hero-rotation' / etc.
      slice: Partial<FilterScope>  // chart filter to highlight
    }
    drillDown: Partial<FilterScope>  // drawer pre-filter
  }
  ```

- **Significance gate**: a card with `sampleSize < N` or `confidence
  < threshold` is dropped before render. Conservative defaults — we
  would rather under-surface than mis-surface.
- **Top-K ranking**: cap the rendered set at ~6 cards so the
  dashboard doesn't become a wall of text. Severity × confidence
  drives the ordering.

### Initial rule catalogue (first ~8)

These are the rules to ship in F's first version. Each line names
the rule, the slice, and the action it's pointing at:

| # | Rule | Slice | Action |
|---|---|---|---|
| 1 | **Hero WR drift** | per-hero | "Lúcio WR dropped 65 → 48 % in last 30 d (n=22)" |
| 2 | **Hero map mismatch** | hero × map | "On Volskaya you're 28 % WR (n=9); off-map your average is 56 %" |
| 3 | **Time-of-day tilt** | by hour bucket | "Your post-23:00 winrate is 41 % vs 58 % daytime" |
| 4 | **Role pivot suggestion** | by role | "Off-role tank is 64 % WR vs main support 51 % — queue tank more?" |
| 5 | **Hero-pool concentration** | overall | "82 % of your playtime is on one hero. Consider expanding pool." |
| 6 | **Streak guard** | recent | "You're 0-6 in the last hour. Consider stepping away." |
| 7 | **Stat decline** | per-hero | "K/D on Tracer dropped from 1.8 → 1.1 over 30 d" |
| 8 | **Schedule consistency** | weekly | "You played 4 fewer days this week vs your 30-day baseline" |

Rules to defer until later (need bigger sample or richer parse):

- Pre/post-patch performance split — requires manual patch entry +
  date binning.
- Rolling-baseline t-test on stats — requires session boundary
  detection (FEATURES.md backlog).
- Off-role surprise stat — requires role coverage we don't yet have.

### UX patterns

- **Card chrome**: tight rectangle, severity stripe on the left
  (green / neutral / amber), 1-line title, 2-3-line narrative, two
  buttons: **View chart** (scrolls + highlights the anchor chart)
  and **View N matches** (opens the drawer).
- **Dismiss**: per-card "✕ Don't show again" — persists in
  `localStorage` keyed by rule id + slice fingerprint. Re-surfaces
  when the underlying metric drifts past the threshold by another N
  %, so a dismissed card can come back if the player slumps further.
- **Loading / empty**: when no card crosses the surfacing threshold,
  the cards row collapses to a single muted line: "Nothing
  noteworthy in this scope — drill into a chart for raw numbers."
- **No "AI" framing**: the rules are simple statistics; the user
  should know it's rule-based heuristics, not an oracle. The
  language should be observational ("Your Lúcio WR is …"), never
  prescriptive in absolute terms ("You should play …").

### Tradeoffs to remember

- **Threshold tuning is the whole game.** Cards that fire too often
  become noise; cards that fire too rarely become invisible. Start
  conservative; add a debug view that shows ALL candidate cards (so
  we can see what's being filtered out) until thresholds settle.
- **Sample size cuts are unforgiving.** A player with 30 matches
  total will see almost no cards. Surface a different empty-state
  for "scope too small" vs "nothing to flag."
- **Per-hero rules need normalisation across hero kits.** K/D
  thresholds for Tracer vs Mercy are not comparable. Either keep
  rules hero-relative (vs that hero's baseline) or skip per-stat
  rules until we have hero buckets.
- **No LLM, no ML, no networked services in F.** Pure local rule
  engine. F's whole value prop is "fast, offline, deterministic."

### Out-of-scope for F

- LLM-narrated cards (Phase G)
- Forecasting / projection ("at this pace you'll hit Diamond by X")
- Comparison vs aggregated community baselines (privacy + scope)
- Push notifications / nudges outside the app
- Coaching playlists pointing at external content

---

## Phase E: current state (paused — sketch on `main` of the

branch)

The Analysis tab ships behind the `g+a` keyboard shortcut and a 5th
nav button (between Matches and Unknown). Routing lives in
`App.vue`; the layout lives in `MatchesDashboardSketch.vue`. None of
the charts read real data yet — every panel renders a placeholder
SVG sketch sized to the slot it will eventually fill. The point of
the sketch is to lock placement + the F integration point (insights
column) before we wire `useMatchHeatmap`-style composables for each
chart.

### Wiring already in place

- **Tab nav.** `TAB_ORDER` in `useTabKeyboardNav.ts` now reads
  `['settings', 'ingest', 'matches', 'analysis', 'unknown']`.
  Arrow-key cycling + Home/End respect the new fifth position;
  the cheatsheet shows `g+a → Go to Analysis view`.
- **Drill-down round-trip.** `MatchesDashboardSketch` accepts
  `:records` + `:selected-match-key` props and emits `open-match`.
  `App.vue` routes that emit into `selection.open(matchKey)` — the
  exact same composable the Matches detail panel uses — so the
  detail panel + lightbox + cheatsheet (per-panel context) all
  light up unchanged from the Analysis side.
- **Floating drawer FAB.** Bottom-right of the dashboard;
  open → slide-in panel listing the top-N most-recent matches in
  scope (sketch wires `[...records].sort().slice(0, 8)` for now).
  Each row is `result-tinted`, shows map/hero/EAD/result, and clicks
  through to `open-match`.

### Layout slots (final shape — these stop moving in F)

| Slot | Component | Notes |
|---|---|---|
| Scope bar (top, sticky) | inline in sketch | Date / Hero / Map / Role / Result + Reset. Future: backed by a new `useDashboardScope` composable. |
| KPI tiles (4 columns) | inline | Winrate / Matches / Streak / Avg K/D. Severity stripe per tile. |
| Headline chart + Insights column | inline + `.insights-column` | Winrate over time; insight cards slot in on the right (Phase F home). |
| Hero rotation + K/D trend (two-up) | inline | Stacked area + line. |
| Campaign Log | will hoist `MatchTimelineHeader.vue` | Existing heatmap + sparkline, same 3M/6M/12M picker. |
| Map × Role + Time of day (two-up) | inline | Heatmap + bar chart. |
| Hero pool diversity (full width) | inline | Horizontal bars. |
| Match drill-down drawer | inline | Slide-out from right; emits `open-match`. |

### What's still to wire

- Real composables per chart (`useMatchWinrateTrend`,
  `useHeroRotation`, etc.). Each is a pure function of the
  filtered record list + scope.
- `useDashboardScope` — owns the Analysis-tab scope. Independent
  of `useMatchFilters` so the two tabs filter separately.
- Match drawer: scope-aware (chart click should narrow to the
  matches behind that data point, not just "most recent").
- Chart hover affordances + click-through to drawer.
- Real Campaign Log mount inside the Analysis layout (currently a
  CSS-only stub at the right placement).

### Why we paused

The Matches tab needs a parallel redesign focused on its own
strengths (per-match drill-down, narrow-to-a-set affordances).
Once that lands and the FilterRail / detail-panel patterns settle,
the Analysis tab will resume on a stable substrate; the scope-bar
mechanics may end up sharing primitives with whatever the Matches
redesign produces. Picking up here means: pick a chart, write its
composable + SVG component, swap it in for the sketch slot.

## Phase E: Layout sketch ground rules

Phase E is in code on the Analysis tab, so most of its decisions
live in the components themselves. A few things worth pinning here
because they pre-shape F:

- **One scope, applied globally to the dashboard.** Every chart on
  the Analysis page reads the same filter scope. No per-chart
  filters; if a chart needs a different view, click into the drawer
  instead.
- **Charts are read-only viz; the scope bar is the only filter
  surface on Analysis.** Keeps F's "anchor chart" semantics
  meaningful — the chart an insight card points at is always the
  *current chart on screen*, not a transient pop-up. (The Matches
  tab still has its FilterRail; the two tabs filter independently.)
- **Match drill-down opens the shared detail panel.** Clicking a
  drawer row or a chart segment that wants per-match inspection
  fires through to `useSelectedMatch.open(matchKey)` — the same
  composable that drives the Matches tab's detail panel + lightbox.
  No new per-match UI on Analysis.
- **Campaign Log keeps its place.** The calendar heatmap + brush
  sparkline are the canonical "when did I play" widget; they
  promote into the Analysis chart grid as the temporal anchor.
  Until the FilterRail / Matches refactor decides their fate, they
  also still mount on the Matches tab.

That's enough rules to keep the F overlay coherent later.
