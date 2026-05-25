# Unknown screenshots

The **Unknown** tab (04 in the tab bar) is the triage queue for
match records Recall couldn't fully resolve. If everything parsed
cleanly the tab title reads "All screenshots resolved." and the
view is empty.

Otherwise: each unresolved record gets a card with an amber left
bar, an internal `match_key`, and a per-field diagnostic strip
showing which fields the parser could and couldn't extract.

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

### Capture the missing slot and re-parse

The slot indicators tell you what's missing. If the record shows
TEAMS + PERSONAL chips green but SUMMARY dashed, that's a "you
forgot to capture the SUMMARY tab" — the most common cause.

What to do:

1. The match is over; you can't go back and re-capture in-game.
2. But: future matches won't repeat the problem if you set a
   consistent capture habit. Most people use a single key bound to
   screenshot and press it once on each post-game tab: SUMMARY first
   (always), then TEAMS, then PERSONAL × however many heroes you
   played. Optionally RANK at the end if it's a comp game.

For the existing Unknown record: it'll stay in this queue as a
permanent reminder until you either accept it (it can sit there
indefinitely; doesn't break anything) or delete the whole database
via **Ingest → Data → Clear Parse Database** and re-parse what
you've kept.

### Re-trigger Parse if the screenshots ARE there

Sometimes a record lands in Unknown because Recall hadn't seen a
SUMMARY screenshot at parse time, but you've since added it to the
folder. The fix:

1. Confirm the SUMMARY PNG is in your screenshots folder (the path
   under **Settings → Directories → Screenshots Folder**).
2. Go to the **Ingest** tab.
3. Click **Run Parse**.

Recall will pick up the new SUMMARY, match it to the existing
Unknown record by filename timestamp (post-match tabs landed within
the same 2-minute window get merged), and the record graduates to
the Matches tab with the map populated.

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
2. **Ingest → Data → Clear Parse Database**.
3. Re-run **Manual Parse**.

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

## Next chapter

- **Get help with anything else**: [Bug reports & feature requests](feedback.md)
