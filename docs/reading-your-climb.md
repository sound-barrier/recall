# Reading your climb

Recall's numbers are all built from your own screenshots. Nothing here
comes from a published ladder distribution, a leaderboard scrape, or an
average taken over other players — the app has no idea who else is
playing. Every comparison on this page is you against you.

That constraint is why these surfaces look the way they do, and it is
worth knowing before you read them.

## Blank is not zero

The single rule that governs every number in this chapter:

> **A reading Recall could not take is left blank. It is never shown
> as a zero.**

Overwatch does not put every number on every screen, and OCR does not
read every number it is shown. A rank update card that was captured
mid-animation, or with a hero model standing in front of the caption,
may give up its tier and not its movement. When that happens Recall
prints nothing in that slot rather than `0%`.

This matters more than it sounds. A run of unread movements shown as
zeros reads exactly like a week where your rank did not move — which is
the single most alarming thing a climb tracker can tell you, and it
would be an artifact of your capture quality rather than anything that
happened in your games. Where a surface needs several readings to say
something, it tells you how many it actually got: *"built from 6 of 19
matches"*.

If a widget looks emptier than you expected, that is the honest answer
and usually the fix is more rank screenshots, not a different filter.

## Where do I stand?

**Elo Calculator → the standing card.**

Since season 4, Overwatch's rank update screen carries a line telling
you what share of players you are ranked above. When one of your
captures reports it, Recall shows the most recent reading, and how it
has moved:

```text
Above 61% of players        up 9 pts since the start of the season
```

Two things about this card are deliberate:

- **It only compares readings inside one season.** A rank
  redistribution moves the whole population at a season boundary, so
  the same percentage means a different thing on either side of it.
  When your two readings straddle a boundary the card shows the
  current one and says why it is not subtracting.
- **It is absent entirely when no capture has reported a percentile**,
  rather than showing an estimate. An earlier version of this card
  printed a share taken from a published distribution table; season 4's
  redistribution voided that table and every number the card had ever
  shown along with it. The replacement reports what your screens said
  or it says nothing.

The movement is quoted in **points**, not percent — the gap between
being above 52% of players and above 61% of them is nine percentage
points, and calling it "up 17%" would be a different claim.

## Percentile over time

**Matches → Trends → Where you rank.**

The same reading, charted. This is the one chart in Recall whose
y-axis is a real quantity measured on a real scale: 0 to 100, straight
off your screenshots. (The rank ladder chart beside it plots a
tier/level/progress composite, which is useful for shape but is a
Recall invention.)

Expect a **sparse** line. Only post-placement rank screens carry a
percentile at all, so a few points across hundreds of matches is
normal, and the line connects across the gaps rather than pretending
the matches in between reported anything.

The rank ladder chart's tooltip carries the percentile too, alongside
the tier and progress, so hovering a point tells you where that reading
put you.

## Am I actually playing better?

**Matches → dossier → Form vs your baseline.**

Compares the last 7 days against the 30 days *before* that — two
windows that do not overlap, so your recent form is not being compared
against a period that includes itself.

The headline is a **sigma**, not a percentage gap:

```text
Last 7d   58%  ·  +1.4σ vs your 30-day baseline
```

A three-match sample will happily swing twenty points on nothing at
all, and quoting that swing as a percentage makes noise look like a
trend. The sigma answers the question you actually have — *is this
difference bigger than my usual scatter?* — and the widget declines to
compute one at all below eight decisive games in either window.

Rough reading: below 1σ is normal variation, above 2σ is a real change
in how the week went.

## Did the ladder agree?

**Matches → dossier → Play vs rank.** *(on by default)*

Puts the two together: how you played this week, and what your rank
actually did about it.

| Verdict | What it means |
|---|---|
| **Rank deflation** | You played measurably above your baseline and the rank did not move, or fell. |
| **Lucky** | You played measurably below it and the rank climbed anyway. |
| **In step** | The movement matched the play. |
| **Not enough read** | Too few matches, or too few legible rank movements, to say. |

The rank side has its own evidence floor: at least half the matches in
the window must have reported a movement before their total is allowed
to stand for the week. One legible pill out of twenty describes those
captures, not the week — and "deflation" declared off a sample of one
is exactly the wrong thing to tell someone about their climb.

## How fast am I climbing?

**Matches → dossier → Climb velocity.**

Rank movement per **session** and per **week**, over the last 30 days.
Both denominators come from the same window as the total, so the
numbers describe one span rather than dividing a month's movement by a
year's worth of sessions.

Per-session is the one to watch: it is the unit you actually play in,
and it answers "is a night of this worth it?" in the terms you'd ask.

Null on both when nothing in the window reported a movement — the rate
is unknown, which is not the same as flat.

## Today's session

While you are playing, the session readout stays up: a running W/L/D
for the current session, updating as screenshots land. It clears itself
when the session does — a gap long enough to count as a new session
starts a new count rather than adding to yesterday's.

Sessions are also a grouping option in the leaves list, so a finished
session can be read back the same way you watched it.

## Next chapter

- **Slice your match history**: [Filtering and grouping](filtering.md)
- **When a screenshot won't parse**: [Unknown screenshots](unknown-screenshots.md)
