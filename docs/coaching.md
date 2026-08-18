# Coaching

Recall can hand your matches to someone else for review, and hand their
notes back. Two files, passed between two copies of Recall — no
account, no server, nothing uploaded. You send a bundle; they send
notes; you decide which of those notes to keep.

This chapter covers both sides. Skip to [Getting
coached](#getting-coached) if you are the player, or [Coaching
someone](#coaching-someone) if a bundle just landed in your downloads
folder.

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
bottom with **Export bundle…**.

Pick the matches you have a question about. A coach reading forty games
gives you forty shallow notes; a coach reading six gives you six useful
ones.

### 2. Share it

In the dialog, tick **Share with a coach**. That changes what the file
IS — it stamps your handle on it so their Recall can open it as a
session rather than merging it into their own history.

- **Your handle** — the name your coach knows you by. Filled in from the
  last time you shared; you can also set it in Settings → Coaching.
- **Message for your coach** — optional, and the most useful field in
  the dialog. "Watch my ult timing on control" gets you a better review
  than silence does.

Save the `.zip` and send it however you like: Discord, email, a drive
share. Recall has no opinion about that.

### 3. Read what comes back

Your coach sends a `.zip` back. Import it the same way you would import
matches — **Settings → Backup & Restore → Import matches…**, or the
**Import matches…** button in the Matches toolbar. Recall tells the two
files apart on its own.

A **return sheet** opens: one card per note, each showing the match, the
coach's note, any timestamped moments, and the tags they filed it
under. For each one you choose:

- **Accept** — the note lands on that match, signed and dated, and the
  match is marked reviewed by a coach.
- **Skip** — nothing lands.

Nothing is written until you press **Finish**. **Decide later** saves
exactly what you have decided so far and closes; the Matches tab keeps
a banner until every note has an answer.

Accepted notes appear on the match in the detail panel, under your own
journal entry, in the coach's own block. You can remove one at any time
— it is your history.

### 4. Mark your own moments

You do not need a coach to point at a moment. The match journal has its
own **Moments** strip: mark a time, say what happened, and optionally
file it under a focus tag. It reads down the match, exactly as a
coach's does, and sits above their notes because they are your words.

## Coaching someone

### 1. Open their bundle

Click the **profile chip** in the top-right, then **Open a player's
bundle…**, and pick the file they sent.

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
room** (or `g f`).

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

**Export notes** writes a `.zip` holding `notes.json` (what their Recall
reads) and `ledger.html` (a page you can open in a browser, or send to
someone who does not use Recall). Send it back the same way the bundle
came.

**End session** hands their records back and returns you to your own
history. Your notes stay with you — reopening the same player's bundle
later brings them back, so a second session builds on the first.

## Frequently confusing

**Nothing you write in a session touches your own database.** Not the
notes, not the moments. They are filed under the player, and they leave
the screen when the session ends.

**A player's notes file needs a Recall at least as new as the coach's.**
A review with no timestamped moments opens in any version; one with
moments needs a build that understands them, and an older one says so
by name rather than dropping half the review.

**Two coaches can review the same match.** Their notes accumulate as
separate blocks, each signed and dated. Nothing merges.

## Next chapter

- **Read what the numbers mean**: [Reading your climb](reading-your-climb.md)
- **When a screenshot won't parse**: [Unknown screenshots](unknown-screenshots.md)
