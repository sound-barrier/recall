# Filtering and grouping

The Matches tab is built around the **dossier + filter panel + leaves**
shape. The dossier at the top of the page is the headline summary
of "the set you're currently looking at": its W/L/D, winrate,
top maps, top heroes, and the active narrowing clauses. The
**Filter matches** button on the dossier opens a left-side panel
that consolidates every filter dimension into one place. The
**leaves list** below the dossier is the match-by-match view of
the set, with sort + group controls in its header.

Every selection inside the filter panel is combined with **AND**:
pick "Hero: Juno" + "Map: King's Row" + "Result: Victory" and you
see only Juno wins on King's Row. Within a single field, multiple
selections are combined with **OR**: pick "Hero: Juno" + "Hero:
Mercy" and you see matches where either was played. So the mental
model is "any of these heroes AND any of these maps AND any of
these results AND …".

## Opening the filter panel

Two ways:

- Click the **⌗ Filter matches** button on the dossier
  (right-hand side, just below the breakdowns).
- Press `/` from anywhere on the Matches tab — the panel slides
  in and the search box receives focus immediately.

The panel mirrors the right-side match detail panel's contract:
focus stays trapped inside the panel via Tab/Shift+Tab, the
background goes `inert` (no clicks bleed through), `Esc` closes,
and clicking the dim backdrop dismisses. The page underneath
stays visible — every filter change reflows the dossier KPIs +
top breakdowns + leaves list live so the consequences of a pick
are immediately readable.

## What lives in the panel

```text
Search        ⌕ map · hero · mode · note · tag       [/]

Time scope    [All] [7d] [30d] [90d]
              From [📅]   To [📅]   (Clear dates)

Map           [pill × pill ×]  + typeahead dropdown
Map type      [control] [escort] [hybrid] [push] …
Hero          [pill × pill ×]  + typeahead dropdown
              · matches any played
Role          [tank] [support] [dps]

Result        [victory] [defeat] [draw]
Tags          [#stack] [#stream] [#review] …
Leavers       [Include] [Drop from tally] [Hide entirely]

Refinement    Min play time  [__] min
              Min played %    [__] %
              ☐ Show unknown-map matches
```

### Search

Free-text substring match across map, hero (primary + every
heroes-played entry), mode, role, map type, annotation note, and
annotation tags. Case-insensitive. The match shows as you type;
clear the input to drop the clause.

> **Note:** the previous vim-style scoped-clause syntax
> (`note:clutch`, `tag:stack`, `member:Apollo`, `replay:7H1`)
> isn't part of the current search — substring match only.
> See `UI_RECOMMENDATIONS.md` for the plan to restore scoped
> clauses.

### Time scope

Preset chips set common windows: **All time** (default),
**Last 7d**, **Last 30d**, **Last 90d**. The From / To date
inputs accept arbitrary windows — picking either flips the
preset to "Custom" and the chips deselect. **Clear dates**
removes both.

Date filtering applies only to records that have a parseable
`data.date` — undated rows (no SUMMARY screenshot to anchor the
date) pass through every date filter and appear in the leaves
list under the **No date** group when grouping is active.

### Map + Map type, Hero + Role

**Map** and **Hero** are typeahead comboboxes — 31 maps and 51
heroes are too many for a chip cloud. Click the input, type to
narrow the list, click an option to pick or unpick. Selected
items appear as removable pills above the input; `×` drops one.

**Map type** and **Role** are small chip rows (5–6 options each).

The Hero filter is a **broad match** — picking "Lúcio" qualifies
any match where Lúcio was the primary hero OR appeared in the
`heroes_played` array, regardless of how briefly he was played.
To require a meaningful play duration, set a **Min play time** or
**Min played %** threshold below (see [Refinement](#refinement)).

### Result, Tags, Leavers

**Result** is one row with three chips: victory, defeat, draw.

**Tags** lists every annotation tag in your corpus. The
conventional three are `stack`, `stream`, `placement`, but any tag
the user added via the detail panel surfaces here. Multi-select
with OR-within semantics ("any of these tags").

**Leavers** is a segmented control. Three modes:

- **Include** (default) — every match, leaver-tagged or not,
  counts the same.
- **Drop from tally** — leaver-tagged matches stay visible in
  the leaves but the dossier W/L/D and winrate skip them.
- **Hide entirely** — drop leaver-tagged matches from the leaves
  list and the dossier.

### Refinement

**Min play time** and **Min played %** are two numeric inputs
that further qualify the Hero filter. A match passes when the
picked hero has ≥ N minutes of play time **OR** ≥ N % of the
match — either threshold passing is enough. Both at zero (the
default) means the threshold doesn't apply.

**Show unknown-map matches** — by default, matches whose map
couldn't be parsed (corrupt SUMMARY / non-OW PNG / classifier
failure) don't appear in the Matches dossier; they live in the
**Unknown** tab where the triage UI is. Toggle this on to surface
them in the leaves list — useful for one-off investigations.

## Active-clause chips on the dossier

Once at least one clause is engaged, the dossier eyebrow flips
from "Set" → "Narrowed set" and a removable-pill row appears
below the headline:

```text
Narrowed set
last 30d — Lijiang Tower — lúcio · mercy
3M / 1L / 0D · 75% WR

[Range: last 30d ×] [Map: lijiang tower ×] [Hero: lúcio ×]
[Hero: mercy ×]                                  [Clear all]
```

Each chip's `×` drops just that single clause from the filter.
**Clear all** drops every clause back to defaults (same as the
**Reset** button inside the panel's footer).

The panel's **Done** button closes the panel without changing
state. Reopen with `⌗ Filter matches` or `/`.

## Sort + group controls on the leaves

Above the leaves list (`Members · N matches in this set`):

- **Sort** — two-button segmented control: **Newest ↓** (default)
  or **Oldest ↑**. Sorted by `data.date` + `data.finished_at`
  composite; ties break by parse order.
- **Group** — five-button segmented control: **—** (none, flat
  list), **D** (day), **W** (week, Monday-anchored to match the
  Calendar setting's default), **M** (month), **Y** (year).
  Default is **D**.

When grouping is active, thin section dividers separate buckets:

```text
─── Sat May 24                    [3]   ─────────────────
```

Bucket label on the left, member count in the chip, line trailing
to the right edge. Undated records collect under a **No date**
divider when any grouping is active.

The **First Day of Week** setting (Settings → Calendar)
determines where the week boundary lands — see
[Settings reference → Calendar](settings-reference.md#first-day-of-week)
for the regional defaults.

## Customizing the dossier

The dossier isn't fixed — every KPI and breakdown is a **widget** you
can rearrange or hide, with **no edit mode** to toggle first. Hover
any widget to reveal its two controls: a drag-grip (⠿) to reorder it
within the grid, and a × to remove it. The **Add** button (top-right
of the dossier) opens a compact menu listing every removed widget and
section, each with a **+** to bring it back, plus **Reset** to return
to the install default.

Below the dossier grid sit two full-width **bands** — the Campaign Log
heatmap and the Geography band (next section) — that are themselves
removable + reorderable sections, both on by default. Remove one with
the inline × on its header; re-add or reorder it from the same **Add**
menu. The dossier always stays on top; only the bands below it
reorder. The whole layout persists per profile across launches.

## The Geography band

The **Geography** band (its eyebrow reads *Map × role performance*) is
a contribution-graph-style heatmap: one row per role (Tank / DPS /
Support), one column per map grouped by map type, each cell shaded by
win rate and labelled with its W-L-D on hover.

It drives the global filter directly:

- **Click a cell** to narrow the whole set to that map + role pair —
  the same as picking them in the Filter matches panel.
- **Click a map-type group header** to narrow to that map type
  (control, escort, hybrid, push, flashpoint, clash).

The band's **gear** (top-right) is a *band-local display filter*,
separate from the global Filter matches panel: it trims which roles,
map types, or specific maps the heatmap draws, without touching the
dossier KPIs or the leaves list. A window toggle (1M / 3M / 6M / 12M)
scopes the heatmap to a recent slice. Both the gear picks and the
window persist per profile.

## Per-row drill-down

Clicking any leaf row opens the **match detail panel** from the
right edge. Inside the panel you can edit the annotation
(note, replay code, group members, leaver flag, tags),
soft-delete the match, and see the full Heroes Played + Match
Stats + Rank Update + Source Screenshots dossier. The panel
honors ← / → for prev/next match against the *currently filtered*
list, so once you've filtered to "every Lúcio loss on Rialto"
the arrow keys paginate through that exact set. See
[How it works → The Matches view](how-it-works.md#the-matches-view)
for the panel's keyboard contract in detail.

## Match count

The dossier subline reads the current state:

- **No filter active** — `spans your full history`
- **Filter active** — `N of M matches in this view` (N is the
  filtered count; M is the total corpus, minus any soft-deleted
  matches you haven't surfaced via the detail panel)

## Filter state persistence

Filter selections are **session-scoped** — they don't
survive a page reload. The reasoning: a filter is typically a
"right now, I want to see…" question, not a permanent view.

A handful of cross-cutting preferences DO persist across launches
(localStorage on every supported platform):

- **Theme** (Day / Night / Contrast — fresh installs follow the
  OS preference)
- **First day of week** (Sunday / Monday / …)
- **Screenshots folder**
- **Window size** for the Campaign Log heatmap and the Geography
  band (1M / 3M / 6M / 12M — each band remembers its own)
- **Dossier layout** — which widgets + bands you've added, removed,
  or reordered (see [Customizing the dossier](#customizing-the-dossier))
- **Geography band filter** — the gear's role / map-type / map picks
- **Tesseract path** + the rest of Settings

Saved-filter presets (so a "stack games last weekend" filter
survives a reload) are tracked in `UI_RECOMMENDATIONS.md` —
the old preset feature was retired with the FilterRail and a
typed replacement is in the backlog.

## Next chapter

- **What to do when a screenshot won't parse**: [Unknown screenshots](unknown-screenshots.md)
