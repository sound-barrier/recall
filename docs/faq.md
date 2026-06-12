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

## I updated Recall and now it won't open, or my matches look wrong

Recall has **no database migrations** before 1.0, so an update that changes the
database layout can leave your old database incompatible. The fix is to wipe the
database — Recall rebuilds an empty one on next launch and re-parses your
screenshots folder, so your matches come back.

On **Windows**, use the guided reset script (it backs up first): double-click
`C:\Program Files\recall\Reset-Database.bat`, which ships with the installer, or
download `recall-{version}-Reset-Database.bat` from the
[releases page](https://github.com/sound-barrier/recall/releases). Full steps —
and what's kept vs. lost — are in
[Resetting your database](install-windows.md#resetting-your-database-no-migrations-yet).
On **macOS / Linux**, close Recall and delete `recall.db` (plus its `-wal` and
`-shm` sidecars) from the active profile's `db` folder under the app-data dir
(`~/Library/Application Support/Recall/` on macOS, `~/.config/recall/` on Linux).

## Will I lose my matches if I reset or wipe the database?

Your matches come back — your screenshots are the source of truth, and Recall
re-parses them to rebuild the database. What you lose is anything that lives
**only** in the database because it isn't on a screenshot: match notes, tags,
tagged teammates, leaver flags, replay codes, review state, queue / play-mode
overrides, and hidden-match flags. The Windows reset script backs the database
up first, so you can copy it back if you change your mind.

## Does Recall change or delete my screenshots?

No. Recall only **reads** your screenshots to parse them — it never edits or
deletes the image files. You can keep, move, or back up your screenshots folder
however you like; if you move it, re-point Recall at the new location under
Settings → Folders.

## How do I back up Recall, or move it to a new computer?

Everything Recall knows — settings plus the match database, per profile — lives
in one folder. Close Recall, then copy it to back it up or carry it to another
machine:

- **Windows:** `%AppData%\Recall\`
- **macOS:** `~/Library/Application Support/Recall/`
- **Linux:** `~/.config/recall/`

Drop it in the same place on the other machine (Recall closed) and your profiles,
settings, and matches come over. Your screenshots live separately — copy that
folder too if it isn't on cloud/shared storage, and re-point Settings → Folders
if its path is different there. One caveat: with no migrations, a database only
reliably loads in the **same** Recall version, so install the matching version
first — or just copy your screenshots and re-parse on the new machine.

## A new hero or map shows as "Unknown" — do I need to reinstall?

No. Recall ships its hero/map roster separately from the app, so a new season's
content can be recognized without a reinstall. Click **Check for updates** in the
masthead; if a roster update is available, apply it and re-parse (or let the
watcher do it). Previously-Unknown screenshots for the new content get recognized
on the next parse — you don't re-capture anything. See
[Updates & game data](settings-reference.md#updates--game-data).
