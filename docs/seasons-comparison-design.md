# The Compare tab

The **Compare** tab (05) answers "am I doing better?" in two modes over one
comparison engine: **Seasons** (two competitive seasons side by side) and
**Form** (two adjacent windows of play, judged into a verdict).

## Form mode

Form compares this stretch of play against the one before it:

- **By time** — pick "this period" on a calendar; the baseline auto-mirrors to
  the immediately-preceding window of identical length (unlockable for a custom
  baseline). Preset chips cover the daily drivers: last 7d vs prior 7d, last
  30d vs prior 30d, and — when a previous season exists — **same point last
  season** (the prior season truncated to the same elapsed days, the only fair
  mid-season comparison).
- **By matches** — the last N matches vs the N before them (10/20/50), fair by
  construction, no calendar involved.
- **Conditions** — each window can be filtered to duo-with-a-member, solo,
  weekday/weekend, a role, or a hero, so "duo vs solo this month" is the same
  table as "this week vs last week".

The answer comes first: a **verdict word** — SHARPER / SLIPPING / HOLDING, or
TOO EARLY TO CALL under five decisive games — computed from weighted rate
movers (win rate, deaths, elims/assists, rank progress), with the top movers as
the subline and a facing **rolling-winrate sparkline pair** showing each
period's shape. The sectioned A/B/Δ table sits below as evidence, gaining
Form-only rows (rank progress in divisions, sessions, leaver rate), and its
cells **drill through** to the Matches tab with the window + dimension applied
(cells whose condition the narrow can't express — solo, weekday/weekend —
aren't drillable).

Pure logic lives in `match-form-slices.ts` (window math, pairing, conditions,
rolling winrate) and `match-form-verdict.ts` (weights + thresholds); the two
modes share `CompareTable.vue` and the `compareSnapshot` builder.

## Seasons mode

## What it shows

Pick a **Baseline (A)** and a **Compared (B)** season from the two chapter-grouped
selectors. Metrics are grouped into labeled sections, each row an **A / B / Δ**
triple:

- **Overview** — record (W–L–D), total games, competitive vs quick-play games,
  role-queue vs open-queue games, and win rate. Win rate carries its Wilson 95%
  margin and decisive-match count (`67% ±37 · n=3`); a season with fewer than
  five decisive matches is tagged `n<5` so a rate that swings on a single result
  reads as noisy.
- **Combat** — eliminations / deaths / assists per 10 minutes.
- **Consistency** — time played, longest win streak, longest losing streak.
- **Roles** — win rate per role (Tank / DPS / Support, as `58% · 12g`), hero pool
  per role, and the highest-win-rate hero per role (min 5 decisive games).
- **Maps** — most-played map, plus win rate + games per game mode (Control,
  Escort, Hybrid, Push, Flashpoint, Clash) played in either season.
- **Heroes** — most-played hero and the lowest-win-rate hero (min 5 decisive
  games, so a one-off bad game can't take the title); plus the hero-swap
  discipline rows: the derived **hero pool** (heroes with at least
  max(5, 10% of the window's decisive games) meaningful decisive games — the
  floor rules small histories, the share keeps a large one's pool to actual
  mains), single- vs multi-hero game rates, and in-pool vs
  out-of-pool game rates. "Meaningful" ignores heroes under 5% of a match
  (touched the point) — the same semantics as the *Heroes per match* and
  *Hero pool* dossier widgets, which additionally expose the threshold as a
  gear knob (3/5/10%).

The **Δ (B vs A)** column frames the change as season B relative to season A: a
green ▲ when B improved, a red ▼ when it regressed, and a muted signed value for
metrics with no "better" direction (games, time, hero pool). ▲ always means "B
is better", so a *lower* death rate reads as a green ▲. The winning column's cell
is tinted.

## Scope toggle — full seasons vs the current filter

A **Full seasons ⇄ Current filter** toggle chooses each column's source:

- **Full seasons** aggregates the entire season A / entire season B.
- **Current filter** applies whatever is picked in the Matches narrow panel —
  minus its own season clause — inside each season, so you can compare, say,
  only your Juno-on-King's-Row games across S1 and S2.

The current-filter source reuses the narrow's `narrowedExceptSeason` ref (the
same skip-variant machinery behind the Geography and Hero×Mode bands).

## How it reuses the dossier

Each column is a full `useMatchesDossier` instance over a season-filtered record
ref — the season is placed by **start time** (`seasonForMatch`), the same rule
the filter and heatmap highlight use. The comparison reads the dossier's bedrock
refs (`wld`, `winrate`, `averageKDA`, `totalTimePlayed`, `longestWinStreak`,
`longestLosingStreak`, `topRoles`) for the scalar metrics; the compare-specific
breakdowns the dossier doesn't expose — per-role hero pools, best/worst hero,
per-game-mode win rate, most-played map, and the playlist / queue-type counts —
are pure functions in `match-compare-aggregate.ts` over the season's record
slice. `match-compare-helpers.ts` then turns the two snapshots into the labeled
sections (delta, direction, Wilson caveat). No backend or schema changes.

## Untimed matches

A match with no derivable start (`seasonForMatch → null`, e.g. an unmatched
screenshot with no SUMMARY date) belongs to neither column. Rather than silently
dropping it, the view surfaces the excluded count below the table so the
comparison isn't lossy.

## Possible future extensions

- **N-way comparison** — the same aggregation generalizes to more than two
  columns; the current UI is fixed at two.
- **Sparkline-per-metric** — a small trend beside each row for the seasons in
  between.
- **Chapter roll-up** — compare a whole chapter (its seasons summed) against
  another.
