# Filtering and grouping

The Matches tab's filter rail at the top of the page is the main
slicing tool. Seven multi-select pills, two date inputs, a sort
toggle, an expand-all button, a minimum-play-time threshold, an
include-undated switch, and a "Clear Filters" escape hatch.

Every selection is combined with **AND**: pick "Hero: Juno" + "Map:
King's Row" + "Result: Victory" and you see only Juno wins on King's
Row. Within a single field, multiple selections are combined with
**OR**: pick "Hero: Juno" + "Hero: Mercy" and you see matches where
either was played. So the mental model is "any of these heroes AND
any of these maps AND any of these results AND …".

## The seven multi-filter pills

Each pill is a popover-style multi-select with the same shape:

| Pill | What it filters on |
|---|---|
| **Mode** | Quickplay, Competitive, Unranked, Arcade modes you've played |
| **Map** | Antarctic Peninsula, King's Row, Nepal, … only maps that appear in your match history are listed |
| **Type** | Control, Push, Escort, Hybrid, Flashpoint, Clash — Overwatch's game type |
| **Role** | Tank, DPS, Support |
| **Hero** | Every hero you've played; clicking checks the match's primary AND any swap heroes (heroes_played) — so "filter by Mercy" finds matches where you played Mercy even briefly |
| **Result** | Victory, Defeat, Draw, (and "unknown" for matches where the result wasn't parseable) |
| **Source** | Which screenshot types fed each match: SUMMARY, TEAMS, PERSONAL, RANK. Useful for spotting partial parses ("show me matches that have a SUMMARY but no PERSONAL") |

### Inside a filter popover

Click the pill to open. The panel has:

- **A small hint** — *"Picking multiple matches any of them."* — to
  reinforce the OR-within-a-field semantics.
- **Search box** — appears when there are 8+ options. Type to narrow
  the list (case-insensitive substring match).
- **Roster** — checkbox-style row per option. The currently-selected
  count appears in the header (e.g. *"3 / 12"*).
- **Foot bar** — three buttons:
  - **Select all** — check every option in the current search.
  - **None** — uncheck every option.
  - **Done** — close the popover. (Clicking outside or pressing
    Escape also closes it.)

The pill itself shows up to one selected chip inline. If you've
picked multiple, it shows the first chip plus **+N** where N is the
remaining count.

The eyebrow above the pill turns brand-orange once at least one
option is selected — quick visual scan of "which filters are
currently engaged" without opening every popover.

### Quick-filter from a match card

Every chip on a match card (mode badge, hero name, role pill, map
name, result tag) is itself a clickable filter trigger. Click a hero
name and it toggles that hero into the **Hero** filter; click a map
name and it toggles into **Map**. Active state is shown as a
glowing orange outline on the chip — click it again to remove the
filter.

This is the fastest path to questions like "show me other matches
on this hero", "show me other matches on this map", or "show me
every Mei game I lost".

## Date range

Two `datetime-local` inputs (**From** / **To**) below the pills.
Both inputs default to empty; either side or both can be set.

- Only **From** set → "show matches at or after this datetime".
- Only **To** set → "show matches at or before this datetime".
- Both set → "show matches inside this window".

The **Reset** button next to the inputs clears both at once.

**Heads-up — undated matches.** Recall computes a match's date from
the SUMMARY tab. If you captured only a scoreboard for a match (no
SUMMARY), the date is unknown and that match is **hidden** while
the date filter is active. A small ⓘ chip appears next to **Reset**
showing how many matches are currently hidden by this rule, with
the count and a tooltip — and the **Undated** toggle (below) lets
you bring them back if you want.

## Sort direction

Single toggle in the lower-right of the filter rail:

- **↓ Newest** — most recent matches first (default).
- **↑ Oldest** — oldest matches first.

Sorting is by the match's `finished_at` time (the SUMMARY-derived
end timestamp) when available, falling back to the screenshot
filename timestamp otherwise.

## Expand / Collapse all

Toggles the expand state of every visible card at once. Switches
between **Expand All** and **Collapse All** based on the current
state.

Useful when you've just applied a filter that narrows to a handful
of matches and you want to see everyone's full stats without
clicking the chevron on each.

## Min-play threshold

Hides matches where the selected hero played less than the
configured share of the match. Two mutually-exclusive ways to
express the threshold:

- **As percent** (e.g. 50%) — show only matches where the hero
  played at least half the match.
- **As time** (e.g. 5m 0s) — show only matches where the hero
  played at least 5 minutes.

Engaging one side disables the other (you can switch by zeroing the
active side first). When at least one threshold is engaged, the
**Min play** label turns brand-orange, matching the eyebrow
treatment on the multi-filter pills.

Filter semantics: a match qualifies when **any** candidate hero
meets the threshold. So if you've also filtered "Hero: Juno" and
set min play to 50%, you see only matches where Juno played at
least half the match — not matches where Juno was *one of* the
heroes for any duration.

## Undated toggle

Appears in the filter tools row only when at least one undated
match exists (records with no SUMMARY screenshot to anchor a
date).

- **Off** (default) — undated matches are hidden everywhere date
  matters: from the Matches list, from the date filter, from group
  headers.
- **On** — undated matches show up in the list under a synthetic
  "Undated" group at the top.

The toggle's label shows the current count
(**Undated · 7**) so you know what's hiding before you click it.

## Clear Filters

Red "Clear Filters" button appears in the filter tools row whenever
any filter is active. One click resets every filter, date range,
min-play threshold, undated toggle, and search box back to default.
Sort direction and the Expand/Collapse state aren't reset (those
are display preferences, not filters).

## Match count

`N of M` chip in the lower-right of the filter tools row. **N** is
the count after filters; **M** is the total in the database. When
filters are off, **N == M**.

## Group rail (Month → Week → Day)

Above the match list, a small toolbar shows the count of months
visible and one button:

- **Expand all** / **Collapse all** — opens or closes every Month →
  Week → Day group in one shot.

Matches are always grouped by Month → Week → Day. Each group header
shows the win/loss/draw tally for that bucket. Click any group
header to expand/collapse just that bucket; use the rail's
**Expand/Collapse all** for the whole tree.

The **First Day of Week** setting (Settings → Calendar) determines
where week boundaries land — see
[Settings reference → Calendar](settings-reference.md#first-day-of-week)
for the regional defaults.

## Filter state persistence

Filter selections, sort direction, min-play threshold, and the
undated toggle are **not** persisted across launches — every
session starts with a clean filter state. The reasoning: filters
are typically a "right now, I want to see…" question, not a
permanent view. The Theme + First Day of Week + screenshots
folder are persisted because they're set-once preferences.

If you find yourself re-applying the same filter set every session,
consider [filing a feature request](feedback.md#want-a-feature)
for saved filter presets.

## Next chapter

- **What to do when a screenshot won't parse**: [Unknown screenshots](unknown-screenshots.md)
