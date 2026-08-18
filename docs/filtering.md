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
Search        ⌕ text · or note: tag: leaver: …       [/]

Time scope    [All] [7d] [30d] [90d]
              From [📅]   To [📅]   (Clear dates)

Map           [pill × pill ×]  + typeahead dropdown
Game Mode      [control] [escort] [hybrid] [push] …
Hero          [pill × pill ×]  + typeahead dropdown
              · matches any played
Role          [tank] [support] [dps]

Result        [victory] [defeat] [draw]
Tags          [#stack] [#stream] [#review] …
Leavers       [Include] [Drop from tally] [Hide entirely]
With a leaver  [You left] [Teammate] [Enemy]
With a thrower [You threw] [Teammate] [Enemy]

Refinement    Min play time  [__] min
              Min played %    [__] %
              ☐ Show unknown-map matches
```

### Search

A bare token is a free-text substring match across map, playlist, role,
game mode, hero (the primary plus every heroes-played entry), annotation
note, tags, teammates, and replay code. Case-insensitive. The match
shows as you type; clear the input to drop the clause.

A `field:value` token scopes the match to one field. Multiple tokens
AND together, and a value may be `"quoted"` to keep internal spaces:

| Token | Matches |
|---|---|
| `note:clutch` | annotation note |
| `tag:stack` | annotation tags |
| `member:Apollo` | tagged teammates |
| `replay:7H1` | replay code |
| `leaver:team` | leaver sides — `self` / `team` / `enemy` |
| `thrower:enemy` | thrower sides — same three values |

Plurals collapse (`tags:` ≡ `tag:`, `leavers:` ≡ `leaver:`), and an
unknown field name falls through as bare text so a typo still
searches.

> **Note:** the disruption sides are reachable **only** through
> `leaver:` / `thrower:`. They're deliberately kept out of bare-token
> search — the three values are generic enough that searching `team`
> would otherwise sweep in every match you'd tagged.

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

Above the preset chips, the **Season** dropdown narrows to a
single competitive season, grouped by chapter. A match belongs to
the season it **started** in — the app subtracts the game length
from the finish time — so a game that began just before a season
boundary but ran a few minutes into the new season still counts
toward the old one. Season boundaries are fixed UTC instants shown
in your local time; the season filter combines with the date range
(pick a season *and* a narrower window inside it). Picking a season
also lights its day span on the Campaign Log heatmap (and the sparkline
beside it) — that calendar always shows your full history, so the
highlight is how a season pick reads there. Seasons ship in
`seasons.yaml` and update through the same **Check for updates**
flow as the hero and map rosters — a corrected season date shows up
there as "1 season updated".

#### Describe it in words

Under the date inputs is a **Describe it** field that takes a phrase
instead of two dates:

| Phrase | What you get |
|---|---|
| `today`, `yesterday` | That one day. |
| `this week`, `last week` | Calendar weeks. `this week` runs up to today, not to the end of the week. |
| `this month`, `last month` | Calendar months. |
| `since <weekday>` | Back to the most recent past occurrence — `since friday`, said on a Monday, reaches back three days. |
| `this season`, `last season` | Picks the season, the same as the dropdown does. |

A week is a calendar claim and calendars disagree about where one
starts, so `last week` follows your own **Week starts on** setting.

The field **declines anything it is not sure of**, and says so:
`recently`, `before june`, `last 3 weeks` and a bare weekday all get
"Not sure what that means" and leave your current filter exactly as it
was. That refusal is the point of the feature. A date filter that
guesses wrong is worse than one that does nothing — you would see a
filtered set, believe it means what you asked for, and read conclusions
off it. Rolling windows are already one click away on the preset chips,
so the phrases cover the calendar questions the chips cannot answer.

### Map + Game Mode, Hero + Role

**Map** and **Hero** are typeahead comboboxes — 32 maps and 53
heroes are too many for a chip cloud. Click the input, type to
narrow the list, click an option to pick or unpick. Selected
items appear as removable pills above the input; `×` drops one.

**Game Mode** and **Role** are small chip rows (5–6 options each).

The Hero filter is a **broad match** — picking "Lúcio" qualifies
any match where Lúcio was the primary hero OR appeared in the
`heroes_played` array, regardless of how briefly he was played.
To require a meaningful play duration, set a **Min play time** or
**Min played %** threshold below (see [Refinement](#refinement)).

### Result, Tags, Leavers, Throwers

**Result** is one row with three chips: victory, defeat, draw.

**Tags** lists every annotation tag in your corpus. The
conventional three are `stack`, `stream`, `placement`, but any tag
the user added via the detail panel surfaces here. Multi-select
with OR-within semantics ("any of these tags").

**Leavers** is a segmented control governing how leaver-tagged
matches count. Three modes:

- **Include** (default) — every match, leaver-tagged or not,
  counts the same.
- **Drop from tally** — leaver-tagged matches stay visible in
  the leaves but the dossier W/L/D and winrate skip them.
- **Hide entirely** — drop leaver-tagged matches from the leaves
  list and the dossier.

**With a leaver** and **With a thrower** are separate chip rows
that scope the *set* by which side was disrupted — You / Teammate
/ Enemy. Both are multi-select with OR-within semantics, and both
are sets: a match can be tagged on **both** teams at once (throwers
on either side, or "a teammate left, then I left"), in which case
it surfaces under either pick.

Throwers deliberately have no tally control. A leaver is something
that happened *to* the match; a thrown game still counts.

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

## Filter straight from a row

Every value shown in a match row is also a one-click filter — no need to open
the Filter matches panel for the common case. Click a **Map**, **Mode**, **Queue
type**, **Hero**, **Role**, or **Result** in any row and the set narrows to
matches carrying that value; click it again to clear. It toggles the same picks
the panel does, so they stack (Rialto **and** Competitive) and surface as the
active-clause chips on the dossier.

The value you're filtering by **lights up** across every visible row — an accent
outline, with a small funnel mark in the cozy / compact rows — so the live
filters read at a glance. Hero and Role are *broad*: clicking a role on an
open-queue match filters to every match that played that role, not only the ones
where it was primary.

> Sorting is separate — it lives in the Sort + group controls (cozy / compact)
> and the column headers (Data view). A value-click only ever filters.

### Spreadsheet data view

Switch the leaves to **Data** density (the density control above the list) for a
real table — one row per match, the same value-cells filtering on click — plus a
few spreadsheet conveniences:

- **Sort by column** — click a header to sort by it; **Shift+click** another to
  add a numbered tie-break level. Click again to flip direction.
- **Resize columns** — drag a header's right edge; double-click to reset. Widths
  persist per profile.
- **Frozen leading columns** — the select + **When** columns stay pinned while
  the wider columns scroll.
- **Copy a range** — drag-select a rectangle of cells and **Ctrl / Cmd + C**
  copies it as tab-separated text that pastes straight into Excel or Google
  Sheets. **Esc** clears the selection.

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
Support), one column per map grouped by game mode, each cell shaded by
win rate and labeled with its W-L-D on hover.

It drives the global filter directly:

- **Click a cell** to narrow the whole set to that map + role pair —
  the same as picking them in the Filter matches panel.
- **Click a game-mode group header** to narrow to that game mode
  (control, escort, hybrid, push, flashpoint, clash).

The band's **gear** (top-right) is a *band-local display filter*,
separate from the global Filter matches panel: it trims which roles,
game modes, or specific maps the heatmap draws, without touching the
dossier KPIs or the leaves list. A window toggle (1M / 3M / 6M / 12M)
scopes the heatmap to a recent slice. Both the gear picks and the
window persist per profile.

## Per-row drill-down

Clicking any leaf row opens the **match detail panel** from the
right edge. Inside the panel you can edit the annotation
(note, replay code, group members, leaver and thrower sides, tags),
soft-delete the match, and see the full Heroes Played + Match
Stats + Rank Update + Source Screenshots dossier. The panel
honors ← / → for prev/next match against the *currently filtered*
list, so once you've filtered to "every Lúcio loss on Rialto"
the arrow keys paginate through that exact set. See
[How it works → What it looks like](how-it-works.md#what-it-looks-like)
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
- **Geography band filter** — the gear's role / game-mode / map picks
- **Tesseract path** + the rest of Settings

Saved-filter presets (so a "stack games last weekend" filter
survives a reload) are available from the narrow panel — name the
current set and recall it later; the snapshot persists across reloads.

## Next chapter

- **Read what the numbers mean**: [Reading your climb](reading-your-climb.md)
- **What to do when a screenshot won't parse**: [Unknown screenshots](unknown-screenshots.md)
