# Unknown screenshots

The **Unknown** tab (04 in the tab bar) is the triage queue for
match records Recall couldn't fully resolve. If everything parsed
cleanly the tab title reads "All screenshots resolved." and the
view is empty.

The tab surfaces two kinds of records:

1. **Needs your review** — screenshots the resolver couldn't pin
   to a single match. Statistics (eliminations / assists / deaths)
   matched one or more existing matches in a time window short
   enough that "this could be the same match or a different match
   with identical stats" is genuinely ambiguous. See
   [Needs your review (ambiguous attribution)](#needs-your-review-ambiguous-attribution)
   below.
2. **Unknown maps** — records where the map couldn't be parsed at
   all. Each gets a card with an amber left bar, an internal
   `match_key`, and a per-field diagnostic strip showing which
   fields the parser could and couldn't extract.

## Why a record ends up here

The Unknown tab specifically catches records where Recall couldn't
determine the **map name**. Map is the anchor field for the whole
match identity — without it, the record can't be cleanly placed on
the Matches list. The four most common causes:

| Cause | Symptom |
|---|---|
| **Captured only the scoreboard** (no SUMMARY) | Eliminations / assists / deaths populated, but map / mode / result / date are blank. Recall has the *what* but not the *where* or *when*. |
| **Captured only PERSONAL** (no SUMMARY) | Hero stats populated, but no match context. |
| **A non-Overwatch PNG in the watched folder** | Most fields blank, parser gave up. |
| **Genuine OCR failure on a SUMMARY** | Map field came out garbled enough that the map-snap-to-known-list step rejected it. Rare on modern Tesseract but happens on borderline screenshots (heavy compression, weird HDR, ultrawide aspect ratios). |

## What a record card shows you

Each Unknown card has three layers:

### Card header

- **Index** (01, 02, …) — the row number among unknowns.
- **Match key** — Recall's internal identity (e.g.
  `match:2026-05-24T22:36:31` from a captured SUMMARY, or
  `unmatched:Overwatch 2 Screenshot 2026.05.24 - 22.36.33.04.png`
  for orphans that couldn't be timestamp-anchored).
- **Source count** — how many screenshots fed this record.
- **Slot indicators** — small chips for **SUMMARY · TEAMS ·
  PERSONAL · RANK** that turn green when present and stay dashed
  when missing. The RANK slot has an "opt" badge because it's
  optional for a complete match.

### Field diagnostic strip

8-column grid showing every parseable field with `filled` (white)
or `vacant` (dim italic) status:

| Column | What's in it |
|---|---|
| Map | The map name, if extracted |
| Type | control / push / escort / flashpoint / clash / hybrid |
| Mode | competitive / quickplay |
| Hero | Primary hero from SUMMARY's heroes_played list |
| E/A/D | Eliminations / assists / deaths from scoreboard |
| Damage | From scoreboard right-hand panel |
| Healing | From scoreboard right-hand panel |
| Result | victory / defeat / draw (from SUMMARY) |

A vacant Map column is what landed the record here — the others
are diagnostic context for what *was* extractable so you can decide
how recoverable the record is.

### Expanded panel (click the card)

- **Source files** — the actual PNG filenames that fed this record,
  with an inline preview chip for each. Click a filename to expand
  the preview inline; useful for confirming "did I actually capture
  the SUMMARY for this match, or just the scoreboard?".
- **Stats** — eliminations/assists/deaths/damage/healing/mitigation
  in the same big-card layout as a normal Matches card.

## How to resolve an Unknown record

Recall stores each parsed screenshot as its own row, keyed by
`match_key` (a stable identity derived from the earliest screenshot's
timestamp). When a new screenshot lands later that resolves to an
existing `match_key`, Recall folds it into the same match record on
the next Parse — no DB wipe required. **Incomplete matches can be
repaired without losing what you already parsed.**

### Add the missing slot — even days later

The slot indicators tell you what's missing. If the record shows
TEAMS + PERSONAL chips green but SUMMARY dashed, that's a "you
forgot to capture the SUMMARY tab" — the most common cause. The fix:

1. Reopen the match in Overwatch's **Career Profile → Match History**.
   Recent matches stay viewable for several days; the post-match
   tabs appear the same way they did right after the match ended.
2. Screenshot the missing tab (SUMMARY, usually). Save it into the
   same folder Recall watches.
3. Go to the **Parse** tab and click **Run Parse** (or just wait
   for the watch debounce if **Watch Folder** is on).

Recall will pick up the new PNG, run the correlation pass against
its filename timestamp and stats, find the existing Unknown
record's `match_key`, and fold the new SUMMARY into it. The record
graduates to the Matches tab with the map field populated. Your
existing per-screenshot rows are untouched.

If the match has aged out of Overwatch's history, you can't recover
the original SUMMARY — but the Unknown record can stay in this queue
indefinitely without breaking anything. Or accept the data you have:
the e/a/d/damage/healing fields are still surfaced on the card, just
without map/result context.

### Build a consistent capture habit going forward

Future matches won't repeat the problem if you bind a single
screenshot key and press it once on each post-game tab: SUMMARY first
(always), then TEAMS, then PERSONAL × however many heroes you played,
optionally RANK at the end if it's a comp game.

### Verify the SUMMARY actually parsed

Click into the Unknown card and look at the source file list. If
the SUMMARY PNG is listed but the slot chip is still dashed, the
parser saw the file but didn't classify it as SUMMARY — that
usually means the map detection failed.

Open the SUMMARY PNG (click its filename) and check:

- Is the map name clearly visible at the top of the screen?
- Is the screenshot the full Overwatch UI, not cropped?
- Is it the *post-match* SUMMARY, not the *in-match* scoreboard?
  (They look superficially similar but the post-match one has the
  per-hero "Heroes Played" row at the bottom.)

If everything looks correct and the map is still missing, that's
likely an OCR weakness on the parser's side. See **File a bug
report** below.

### When a record is just noise

If a PNG ended up in your screenshots folder that isn't actually
an Overwatch match (a desktop screenshot, a screenshot from another
game, etc.), the simplest fix is:

1. Delete the offending PNG from your screenshots folder.
2. **Settings → Advanced → Clear Parse Database**.
3. Re-run **Parse → Run Parse**.

This rebuilds the database cleanly without the orphan.

## File a bug report

If you've got a SUMMARY PNG that clearly shows a map name but Recall
won't extract it, that's a parser bug worth reporting. Open the
[bug report form](feedback.md#found-a-bug) and:

1. **Attach the SUMMARY PNG** in the "Overwatch screenshot that
   mis-parsed" field. This is the single most useful data point —
   the maintainer can drop it into the parser's golden-file fixture
   set and reproduce the exact failure.
2. **Attach a Recall app screenshot** of the Unknown tab card
   showing the diagnostic strip — fastest way to communicate "this
   is what I see".
3. **Describe what should have been extracted.** "The map is
   Antarctic Peninsula but Recall left it blank" is a complete bug
   description.

Recall doesn't read BattleTags, so scoreboard tags don't affect
repro; crop or blur them before uploading if you'd like.

## Needs your review (ambiguous attribution)

If two matches share the same hero, map, and `(eliminations,
assists, deaths)` triple inside a 30-minute window, Recall can't
tell them apart from the screenshots alone. Rather than guess —
which can silently merge two distinct matches into one record —
the resolver hands the call back to you.

Ambiguous records appear at the top of the Unknown tab under the
**"Needs your review — N"** subheading. Each card shows:

- The filename of the screenshot needing attribution.
- A **"Pick the match"** block listing candidate matches. For each
  candidate you'll see its key, hero / map / date headline, and
  how far apart in time it is from the ambiguous screenshot
  (e.g. *"12 min apart"*).
- An **Attach to this match** button per candidate.
- A **Treat as new match** escape hatch — picks a fresh
  `match:<timestamp>` derived from the screenshot's filename, so
  the row becomes its own standalone match instead of joining
  any candidate.

Clicking **Attach** rewrites every parent row carrying the
ambiguous sentinel (the original screenshot AND any siblings
captured within 2 minutes of it) to the chosen match key in one
atomic write. The card disappears and the receiving match's
source-file list grows by one.

There's no way for Recall to know which choice is right — you do,
because you played the matches. The ambiguity surface is the
honest answer: a heuristic that picks wrong is worse than a
prompt that asks.

## Reference data gaps

A third section on the Unknown tab — **Reference data gaps** —
lists every record whose hero or map text Recall captured but
couldn't pin to the canonical roster shipped with this release.

The most common cause is a new hero or map released after this
Recall version cut. Example: a record from a Miyazaki play parsed
before `heroes.yaml` was updated with that entry surfaces here.
The card shows the file the record was parsed from + the OCR'd
text Recall couldn't recognise (e.g. `Unknown hero: miyazaki` /
`Unknown map: new-junk-city`). Same record shows the warning on
its leaf row (`Unknown hero (miyazaki?)`) and on the detail
panel's inline banner — three surfaces, one signal.

**What you can do:**

1. **Wait for the next Recall release.** Each release ships an
   updated `heroes.yaml` + `maps.yaml` as attested release
   assets — see [Verifying downloads](../README.md#verifying-downloads).
   Once the new release lands, the next app boot's re-aggregate
   pass picks up the newly-recognised entries automatically (~2–5 s
   on 500 matches) and the record's hero/map flips to canonical
   without re-OCRing.
2. **Hit Re-parse all** under Settings → Advanced to recover
   records parsed by an OLDER Recall version (before this gap-
   detection feature shipped) — they have no preserved OCR text
   to consult, so only re-running Tesseract recovers them.

There is **no manual edit affordance** — you can't type a hero or
map name into a record. The whole point of the gate is that
guessing leads to silent stats corruption (the Miyazaki → Mei
bug). Wait for the YAML to catch up, or re-parse.

The section is hidden when no records carry the gap signal —
common case once the latest release is installed.

## Next chapter

- **Get help with anything else**: [Bug reports & feature requests](feedback.md)
