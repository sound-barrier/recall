# Reviews

Three ways to look hard at a set of matches, and one place for all of
them — the **07 Reviews** tab (`g r`):

- **Review yourself.** Sit down with a handful of your own games in the
  film room, the way a coach would, and keep the review.
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

Per match, write a note and mark **moments** — a time and what happened —
on the strip. The note is prose: a small toolbar gives you bold, italic,
strikethrough, two heading levels and bulleted or numbered lists, and what
you write renders that way everywhere it is read afterwards. Each note
lands on its match the second you write it: open the match in Matches and
the block is there, reading *Your review · in progress*.

On the sheet, give the review a title and fill in **What to work on** — a
list, one line per thing. That list is the point of the whole exercise:
it is what shows up under *What you're working on* at the top of the
Reviews tab, and what Recall says back to you next time you are playing.

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
- your own reviews of those matches — notes and moments included, so a
  coach reads what you already noticed
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

Pick the matches you have a question about. A coach reading forty games
gives you forty shallow notes; a coach reading six gives you six useful
ones.

One hard requirement, worth knowing before you pick: **every match you
send needs its replay code.** A coach reviews by *watching the replay*,
so a match without a code is a match they cannot act on — the send
refuses until each one has its code. Codes live in the match's journal;
the easiest habit is writing each one down right after the game, while
Overwatch still shows it. (The dialog names any match that is missing
one and offers **Show the N on Matches →** to go fix them; what you had
typed is still there when you come back.)

Four doors, all landing in the same dialog:

- **Send to a coach…** on the Reviews tab, under *02 · With a coach* —
  sends everything currently showing on Matches, so narrow the list
  there first to choose the set.
- **Send my last session to a coach** beside it — the same trailing run
  of games *Review my last session* opens, sent instead of reviewed.
- On **Matches**: tick rows and use the bar's send button for exactly
  those, or a row's right-click menu to send just that match.

Do **not** use **Export backup…** for this. That button is a backup of
your data for *you* — the file it writes is not stamped with your
handle, so a coach who receives one gets an anonymous zip: their Recall
can still open it as a session via *Open a player's bundle…*, but it
names nobody, and if they mistake it for match data and use the generic
Import instead, it merges into **their** history. The send dialog exists
so none of that can happen.

### 2. Send it

The dialog opens in place, over the Reviews tab, and shows a manifest —
one row per match, each with its replay code or the gap where one should
be — so you see exactly what is going to another human before anything
leaves.

- **Your handle (required)** — the name your coach knows you by. The
  bundle is stamped with it; that stamp is what makes their Recall open
  the file as a coaching session rather than data. Prefilled from the
  last time you sent; also settable in Settings → Coaching.
- **Message for your coach** — optional, and the most useful field in
  the dialog. "Watch my ult timing on control" gets you a better review
  than silence does.
- **Save as** — the file's name, prefilled with a `recall-share-…`
  stamp so it can never be mistaken for one of your backups later.

Save the `.zip` and send it however you like: Discord, email, a drive
share. Recall has no opinion about that — but it keeps the receipt: the
Reviews tab lists every send, and marks the ones a coach has answered.

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

Above the cards, if your coach wrote one, is their **What to work on**
list. Those are not decided on the way the notes are: they are already on
your list the moment the file is staged. You can disagree with your coach
— but you have to have heard them first, so there is no way to refuse one
here. Discarding the whole file is the only thing that takes them back
off.

Nothing is written until you press **Finish** — and Finish says what it
is about to do: *Finish · 2 accepted · 3 skipped*. Press it while notes
are still undecided and it asks first, because the inbox banner stays up
until every note has an answer. **Decide later** saves exactly what you
have decided so far and closes; the banner — **Read the notes** reopens
the sheet — keeps count of what is left. Once a review lands, its card
under *02 · With a coach* shows the coach, the counts, and **Show these
matches →**.

If the file was the wrong one, or you have decided you do not want the
review, **Discard…** throws it away. That is not the same as skipping
every note — skipping records a decision and marks those matches
reviewed by a coach. Discarding drops the file.

Accepted notes appear on the match in the detail panel, under your own
journal entry, in the coach's own block. You can remove one at any time
— it is your history.

#### If they reviewed a replay code

A coach can review a replay without ever seeing your bundle, so a note
may come back about a match your Recall has never heard of. It is
matched by the **replay code**: if one of your matches carries that
code, the note lands there like any other.

If none does, accepting the note **creates** the match, from what the
coach wrote down while watching. That match is real — you played it —
but it does not count toward your record:

- it appears in **Matches**, carrying the notes and a **Replay review**
  badge, and you can filter for it under *Provenance*;
- it is left out of the dossier and the **Elo Calculator** entirely.

The reason is that its result is what your *coach* typed off a replay,
not what you recorded. A coaching session should not be able to move
your win rate.

If you later add that replay code to a match you already had, the note
binds to it the next time you open the sheet. Nothing to re-import.

### 4. Mark your own moments

You do not need a coach to point at a moment. The match journal has its
own **Moments** strip: mark a time, say what happened, and optionally
file it under a focus tag. It reads down the match, exactly as a
coach's does, and sits above their notes because they are your words.
(A review — above — does the same over a whole set at once.)

## Coaching someone

There are two ways in, and they land in the same room. Take a **bundle**
when the player has exported their history for you; take a **replay
code** when all you were given is six characters in chat, which is how
most reviews actually start.

### 1a. Open their bundle

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

### 1b. Or just a replay code

**Use a replay code…**, in the same place. Type the code, press **Add**,
and start the review. You can add more codes as they arrive — the reel
grows while you work, which is what you want when they are being read
out to you over voice.

The code is echoed back before you start. Check it: it is now the
player's *identity* for that match, so a mistyped code produces a review
they can never be matched to.

You will be asked who you are coaching, exactly as you are for a bundle
that did not name anyone. Nothing you write is saved until you answer —
and if you have coached them before, their name is one keystroke away:
the prompt suggests the names on your roster, and picking a known one
files these notes with that player's existing history instead of
starting a second file over a typo.

#### Or a whole team

The same prompt has a second answer: **A team.** Choose it when the
codes belong to matches *several* of your players were in, give the
team a name, and the whole session files under it — one shared review
about the team's play, not anyone's individual game. Three things
follow from that shape:

- The **What you saw** panel asks for the map, result and date but not
  a hero — a team review names no single player's pick.
- The review travels as the **web page only**: *Save a web page — for
  the team* writes one file anyone can open, and there is no notes
  file to export, because that file is a per-player artifact that
  lands notes on one person's matches.
- The team sits on your roster like a player does, marked **TEAM**,
  with its own standing focus list — the next codes session for the
  same team picks the name from the prompt and continues the file.

A bundle can never be a team: it was exported by one player, and their
manifest is the identity.

Two things are different in this room, both because Recall has never
seen these matches:

- Each frame starts blank, and a **What you saw** panel appears on the
  desk. Fill in as much as you noticed — the map, the hero, how it went.
  Whatever you leave blank stays blank; nothing is invented. The date is
  filled in with today's, which you can change.
- Their Matches, Trends, Compare and Elo tabs are not there to step
  into. There is no history to step into.

Everything else — notes, moments, the focus list, sending it back — is
the same, because it is the same coaching.

### 2. The film room

You land in the film room. Three columns:

- **The reel** on the left — their matches, grouped by day, in their
  local clock, not yours. Click a frame, or use `j` / `k`, `↑` / `↓`,
  or `[` / `]` from anywhere in the room.
- **The desk** in the middle — the match you are looking at, the
  moments strip, and your note about it.
- **The session sheet** on the right — their record, what you have
  written so far, and the one thing to work on.

In a bundle session you can also step into their Matches, Trends,
Compare and Elo tabs from the strip under the masthead, and come back
with **← Back to the film room** (or `g r`). A replay-code session has
no history to step into, and the strip says so instead of offering
empty rooms.

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

**1 · Export notes file — for their Recall** writes a `.zip` holding
`notes.json` (what their Recall reads) and the review page. Send it back
the same way the bundle came. Both export buttons need your coach name
set — if it is not, they say so in plain text right there.

**Save a web page — read-only** writes just the page: one self-contained
HTML file that opens in any browser, offline, with nothing to install.
It is the same document that rides inside the `.zip` — use it for a
player who does not run Recall, or does not want to import anything.
Saving it counts as handing the session over: End will not warn you
about unexported notes after a deliberate page save.

If you reviewed replay codes, the page is usually the one you want —
but only the notes *file* can land notes back on the player's matches,
so if they run Recall, send the file.

**2 · End session** hands their records back and lands you on the
Reviews tab with a notice naming what ended (and where the notes file
went, if you exported one). Your notes stay with you, filed by player
or team.

### The roster and the dossier

Under *For someone else*, the roster lists everyone you have coached —
and each row is a door. **Open their dossier** shows the standing
what-to-work-on list and two ways back in: **Read every note** lists
everything you have ever written about them (labeled by the match's
day, or by its replay code — the matches themselves left with their
sessions, only your words stay), and **Review new codes for them**
opens the codes door already knowing who it is for, so the room never
asks.

Inside a session, the same continuity shows up as a quiet drawer under
the desk: **Earlier notes about {them}** — the notes you wrote in
previous sessions about matches that are not in today's corpus. They
were always saved and always exported; now they are also visible while
you work. A second session builds on the first, and you can see it
doing so.

## What you're working on

At the top of the Reviews tab is one list: everything you are working on,
whatever it came from. Your coach's items come first, then your own, each
newest first.

Two things you can do to an item, and deliberately not a third:

- **Accept** — you have read what your coach sent. It stays on the list;
  accepting is acknowledging it, not agreeing to it.
- **Done with this** — you are done working on it. It comes off the live
  list and folds behind a count, because retiring something is not
  unsaying it.

There is no way to delete an item or turn one down — the band says so
itself. An item you wrote is yours to retire; an item your coach wrote
is theirs to have said. Each item's source line is a door: click it to
reopen the return sheet the coach sent it on, or the review you wrote
it in.

When you are mid-session — Recall knows, because a parse just landed
between games — the top three come back to you once, in the corner, so
you can take them into the next match. Once per session; close it and it
stays closed until the next one. There is also a **What you're working
on** widget you can add to the Matches dossier if you want it in front of
you all the time.

## Frequently confusing

**Nothing you write in a session touches your own database.** Not the
notes, not the moments. They are filed under the player, and they leave
the screen when the session ends.

**A notes file names the format it is in.** A build that does not know
that format refuses the file by name rather than reading half of it and
dropping the rest silently.

**Two coaches can review the same match.** Their notes accumulate as
separate blocks, each signed and dated. Nothing merges — and your own
reviews sit beside them as their own blocks, the same way.

**A coach sees your own notes.** The bundle carries your journal and your
reviews, and the coach's desk quotes them under your note, so they read
what you already noticed before they write.

## Next chapter

- **Read what the numbers mean**: [Reading your climb](reading-your-climb.md)
- **When a screenshot won't parse**: [Unknown screenshots](unknown-screenshots.md)
