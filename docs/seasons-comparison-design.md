# Season comparison — scoped design (not built)

A follow-up to the competitive-seasons filter. This documents *how* a
"Season A vs Season B" performance comparison would be built so the work can
be picked up later; nothing here is implemented yet.

## Goal

Let the user pick two seasons and see their performance side by side —
win/loss, win-rate, average KDA, top heroes/roles, time played — so "am I
doing better this season than last?" is answerable at a glance.

## The seam already exists

The dossier aggregation (`useMatchesDossier`, `frontend/src/composables/matches/`)
is a pure `Ref<MatchRecord[]> → ComputedRef` transform, and the matches store
already instantiates it **four times** over four differently-filtered record
refs (`stores/matches.ts` — `dossier` over `narrowedRecords`, `fullDossier`
over `records`, plus the geography/hero-mode variants). Each is lazy: only the
bedrock refs / query helpers a consumer actually reads recompute.

A comparison view is **two more** instances over two season-filtered record
refs — no new store state, no new aggregation code:

```ts
const seasons = useOWData().seasons
const seasonA = computed(() => records.value.filter(r => seasonForMatch(r, seasons.value)?.name === pickA.value))
const seasonB = computed(() => records.value.filter(r => seasonForMatch(r, seasons.value)?.name === pickB.value))
const dossierA = useMatchesDossier(seasonA, leaverHandling, heroRole, weekStart)
const dossierB = useMatchesDossier(seasonB, leaverHandling, heroRole, weekStart)
```

`seasonForMatch` (`frontend/src/match/match-season-helpers.ts`) already does the
start-time UTC placement. `weekStart`/`leaverHandling`/`heroRole` thread in the
same way the store's existing dossiers get them.

## What to render

Read the **bedrock refs** off each dossier (`wld`, `winrate`, `averageKDA`,
`topRoles`, `totalTimePlayed`, `currentStreak`, `heroPoolSize`) and the
parameterized **query helpers** (`topByCount`, `bestWinrateHero`, …) for a
two-column table, each row a metric with A / B / delta. A small "which season"
pair of selectors (reusing the `seasonsByChapter` grouping) drives `pickA`/`pickB`.

## Open questions for whoever builds it

- **Where it lives** — a new sub-view/tab, a mode of the Trends section, or a
  modal. (Trends already owns the "compare over time" mental model.)
- **Small-sample honesty** — reuse the Wilson-interval treatment the dossier
  already applies to thin win-rates so a 2-game season doesn't read as 100%.
- **Untimed / cross-season matches** — matches with no derivable start
  (`seasonForMatch` → null) belong to neither column; surface the excluded
  count so the comparison isn't silently lossy.

## Cost

Small — the aggregation is reused wholesale; the work is one view component,
two season selectors, and a metric table. No backend or schema changes.
