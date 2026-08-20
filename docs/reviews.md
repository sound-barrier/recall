# Reviews

Three ways to look hard at a set of matches, and one place for all of
them — the **07 Reviews** tab (`g r`):

- **Review yourself.** Sit down with a handful of your own games in the
  film room, the way a coach would, and keep the sitting.
- **Get coached.** Hand your matches to someone else and read what comes
  back. Two files, passed between two copies of Recall — no account, no
  server, nothing uploaded. You send a bundle; they send notes; you decide
  which of those notes to keep.
- **Coach someone.** Open a bundle a player sent you and write the notes.

This chapter covers all three, in that order. Skip to [Getting
coached](#getting-coached) if you are waiting on someone, or [Coaching
someone](#coaching-someone) if a bundle just landed in your downloads
folder.

## Reviewing yourself

You do not need a coach to review a match — you need the room, and the
Reviews tab starts it: **Review my last session** opens the film room
over the trailing run of games you just played, **Review my last N**
over the newest handful, and **Pick matches…** walks you to Matches to
tick exactly the rows you want (then **Review these** on the bar that
appears — the command palette's *Review my last session* is the same
start from a keystroke, and a row's right-click menu has *Review this
match* for just one). The film room opens over them, inside the Reviews
tab, in your own clock: the reel on the left, one match on the desk, the
review's sheet on the right.

Per match, write a note and file it under a focus tag or two, and mark
**moments** — a time and what happened — on the strip. Each note lands on
its match the second you write it: open the match in Matches and the
block is there, reading *Your review · in progress*. On the sheet, give
the review a title and write the one thing to take into your next games.

**Finish review** marks every match in the set *reviewed by self* (a coach's
mark, if one is already there, stays) and keeps the review under
section **01 · Your own reviews** on the Reviews tab. The card shows the
date, the record, and a small rail with one mark per match: filled where
you wrote a note, hollow where you only looked; **Show these matches →**
narrows the Matches list to exactly the set it covers. Open it again any
time — leaving without finishing also keeps everything, marked *in
progress*. **Delete** asks first, then removes the review and its
blocks from every match; the reviewed marks stay, because you did review
them.

A review travels in a share bundle with its matches (the dialog says so),
and a profile move carries it whole — or refuses, if the move would split
it across two profiles.

## What travels, and what does not

Read this before you send anything to anybody.

A share bundle is a `.zip` containing, **for the matches you selected**:

- every screenshot Recall parsed those matches from — Overwatch
  scoreboards, which carry **every player's BattleTag**, yours and
  theirs
- the parsed stats, ranks and hero playtimes
- your own journal layer: notes you wrote, the moments you marked, tags,
  squad members you named, anyone you marked as a leaver or thrower, and
  replay codes
- your own reviews of those matches — the sittings above, notes and
  moments included, so a coach reads what you already noticed
- any review an earlier coach sent back and you accepted — a second coach
  sees the first one's notes
- your handle, and a message to the coach if you write one

It does **not** contain your settings, your file paths, or any match you
did not select.

Two things worth knowing. Your coach can read the screenshots on their
disk even though Recall does not display them during a session — the
images are in the zip. And Recall stamps the bundle with a permanent id
for you the first time you share, so a coach who reviews you twice can
file both sessions under one player.

If any of that is more than you want to share, send fewer matches: the
bundle is exactly the matches you tick, and nothing else.

## Getting coached

### 1. Pick the matches

Go to **Matches**, tick the rows you want reviewed. A bar appears at the
bottom with **Export bundle…** — or, from the Reviews tab, **Share with
a coach…** (its label carries the live count of what would go) takes you
to Matches and opens the same dialog over the set showing there, already
set to share.

Pick the matches you have a question about. A coach reading forty games
gives you forty shallow notes; a coach reading six gives you six useful
ones.

### 2. Share it

In the dialog, tick **Share with a coach**. That changes what the file
IS — it stamps your handle on it so their Recall can open it as a
session rather than merging it into their own history.

- **Your handle (required)** — the name your coach knows you by. Filled
  in from the last time you shared; you can also set it in Settings →
  Coaching.
- **Message for your coach** — optional, and the most useful field in
  the dialog. "Watch my ult timing on control" gets you a better review
  than silence does.

Save the `.zip` and send it however you like: Discord, email, a drive
share. Recall has no opinion about that — but it keeps the receipt: the
Reviews tab lists every share you sent, and marks the ones a coach has
answered.

### 3. Read what comes back

Your coach sends a `.zip` back. Open it with **Open a notes file…** on
the Reviews tab — or import it the way you would import matches
(**Settings → Backup & Restore → Import matches or notes…**, or the
**Import matches or notes…** button in the Matches toolbar); Recall
tells the two files apart on its own.

A **return sheet** opens: one card per note, each showing the match, the
coach's note, any timestamped moments, and the tags they filed it
under. For each one you choose:

- **Accept** — the note lands on that match, signed and dated, and the
  match is marked reviewed by a coach.
- **Skip** — nothing lands.

Nothing is written until you press **Finish**. **Decide later** saves
exactly what you have decided so far and closes; a banner stays up on
every tab — **Read the notes** reopens the sheet — until every note has
an answer. Once a review lands, its card under *02 · From a coach* shows
the coach, the counts, and **Show these matches →**.

If the file was the wrong one, or you have decided you do not want the
review, **Discard…** throws it away. That is not the same as skipping
every note — skipping records a decision and marks those matches
reviewed by a coach. Discarding drops the file.

Accepted notes appear on the match in the detail panel, under your own
journal entry, in the coach's own block. You can remove one at any time
— it is your history.

### 4. Mark your own moments

You do not need a coach to point at a moment. The match journal has its
own **Moments** strip: mark a time, say what happened, and optionally
file it under a focus tag. It reads down the match, exactly as a
coach's does, and sits above their notes because they are your words.
(A review sitting — above — does the same over a whole set at once.)

## Coaching someone

### 1. Open their bundle

Open the **Reviews** tab (`g r`), then **Open a player's bundle…** under
*For someone else*, and pick the file they sent. (The command palette,
`Ctrl+K`, has the same action.)

Their matches are **loaned**, not imported: they never enter your
history, and they leave when the session ends. While a session is open
your own data is read-only — every affordance that would write to it is
disabled, and says so.

Set your name first if you have not: **Settings → Coaching → Your coach
name**. It signs everything you write, and notes cannot be exported
without it.

### 2. The film room

You land in the film room. Three columns:

- **The reel** on the left — their matches, grouped by day, in their
  local clock, not yours. Click a frame, or use `j` / `k`, `↑` / `↓`,
  or `[` / `]` from anywhere in the room.
- **The desk** in the middle — the match you are looking at, the
  moments strip, and your note about it.
- **The session sheet** on the right — their record, what you have
  written so far, and the one thing to work on.

You can also step into their Matches, Trends, Compare and Elo tabs from
the strip under the masthead, and come back with **← Back to the film
room** (or `g r`).

### 3. Mark moments while you watch

The **Moments** strip is the point of the room. Mark the second
something happened and say what it was:

```text
  3:23  positioning   No off-angle — the tank ate the pressure alone.
  4:13  ult economy   No ult tracking.
  4:45                Cassidy flanked behind you.
```

Each moment carries the match's replay code with a copy button, so the
player can open the replay and scrub straight to it. A timestamp they
cannot get to is trivia.

When the match reported its length, the strip spaces the moments by the
time between them — three notes in the last two minutes look clustered,
because they were. A stamp past the end of the match warns and saves
anyway: the length comes from OCR and is often missing, and it should
not overrule the person who watched the game.

Everything autosaves. The note above the strip is for the overall read —
what the match was about — and the moments carry the specifics.

### 4. Send it back

**1 · Export notes** writes a `.zip` holding `notes.json` (what their Recall
reads) and `ledger.html` (a page you can open in a browser, or send to
someone who does not use Recall). Send it back the same way the bundle
came.

**2 · End session** hands their records back and lands you on the
Reviews tab with a notice naming what ended (and where the notes file
went, if you exported one). Your notes stay with you — the roster under
*For someone else* lists every player you have coached, and reopening
the same player's bundle later brings the notes back, so a second
session builds on the first.

## Frequently confusing

**Nothing you write in a session touches your own database.** Not the
notes, not the moments. They are filed under the player, and they leave
the screen when the session ends.

**A notes file names the format it is in.** A build that does not know
that format refuses the file by name rather than reading half of it and
dropping the rest silently.

**Two coaches can review the same match.** Their notes accumulate as
separate blocks, each signed and dated. Nothing merges — and your own
review sittings sit beside them as their own blocks, the same way.

**A coach sees your own notes.** The bundle carries your journal and your
review sittings, and the coach's desk quotes them under your note, so they
read what you already noticed before they write.

## Next chapter

- **Read what the numbers mean**: [Reading your climb](reading-your-climb.md)
- **When a screenshot won't parse**: [Unknown screenshots](unknown-screenshots.md)
