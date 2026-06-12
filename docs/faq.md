# FAQ

Common questions about how Recall reads your screenshots and groups them into
matches.

## When should I take my screenshots?

**Take them after the match ends**, on the post-match screens: the final
SUMMARY scoreboard, your PERSONAL performance tab, and (in competitive) the RANK
progress screen. Capture them within a minute or two of each other.

Recall doesn't watch the game live. It reads still screenshots and stitches the
ones from the same match back together afterward. The post-match **SUMMARY** is
the anchor: it's the only screen that shows the map, the result (victory, defeat,
or draw), the date, and the time the match finished. Those are exactly what let
Recall place a match on your timeline and tell two matches apart.

The in-game **TEAMS scoreboard** (the one you can pull up mid-match with Tab) is
read for combat stats only: eliminations, assists, deaths, damage, healing, and
mitigation. It doesn't carry the map, hero, or result, so on its own it can't
identify which match it belongs to.

## Can I screenshot the scoreboard during the match?

You can, and Recall will use its combat stats, but pair it with a post-match
SUMMARY of the same game. Recall matches the two up by their identical
elimination / assist / death numbers and how close together they were taken. A
lone in-game scoreboard with no matching SUMMARY can't be pinned to a map or
result, so it may land in the **Unknown** or **Ambiguous** triage instead of
merging into one complete match.

## Why did a screenshot land in "Unknown" or "Ambiguous"?

- **Unknown** usually means the OCR couldn't read a map or hero name: a
  brand-new map, a heavy overlay, or a low-resolution capture. A future roster
  update can often recognize it later without you re-capturing anything.
- **Ambiguous** means a screenshot's stats matched more than one nearby match
  and Recall couldn't decide which one. This is most likely when you captured
  only the in-game scoreboard (with no identifying SUMMARY) for two games that
  had very similar stats and were taken close together. Capturing the post-match
  SUMMARY for each game avoids it.

## Which screens does Recall read?

| Screen | What Recall pulls from it |
|---|---|
| Post-match **SUMMARY** | map, mode, result, score, date, finished-at, heroes played |
| **PERSONAL** performance tab | per-hero stats (accuracy, healing, and so on) |
| Competitive **RANK** progress | rank tier, SR change, the competitive flag |
| In-game **TEAMS** scoreboard | combat stats only (E/A/D, damage, healing, mitigation) |

You don't need all four. The SUMMARY alone is enough to log a match; the others
add detail and cross-check the numbers against the SUMMARY.

## Do I have to take screenshots manually every time?

No. Point Recall at your screenshots folder and turn on **Watch** (Settings →
Folders). Recall then picks up new captures automatically as you save them, so
your only habit to build is pressing the screenshot key on the post-match
screens. See [How it works](how-it-works.md) for the full workflow.
