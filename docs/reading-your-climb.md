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

**In SR rather than the meter.** *Climb velocity* counts the progress
meter, because that is what almost every rank screen reports. **SR climb
rate** counts the SR itself, and **SR by hero** splits it — Overwatch
banks SR per hero, so one net figure can read flat while one hero
climbed and another slid. Both ship beside the meter widgets rather
than replacing them: SR is reported on a minority of captures, and each
tile says how many it read ("read on 4 of 19") so you can weigh the
number by what is behind it. A card whose movement pill could not be
read counts as unread, not as a match that moved nothing.

## Did the game change under me?

**Matches → dossier → Patch split.**

Your win rate before the newest patch your set straddles, against your
win rate after it — with the patch named, because a before-and-after
with no boundary named is two numbers and an implication.

Recall knows every season start is a patch. Mid-season balance patches
are real and frequent, and their dates are not something the app can
derive, so it does not invent them: a split at a moment nothing happened
would invite you to explain a difference that is not there. Dates added
upstream arrive through **Check for updates**, like a corrected season.

## Do I tilt-queue?

**Matches → dossier → Fresh vs tilted queue.**

Your win rate after queuing straight back in (under five minutes from
the last game ENDING) against your win rate after an hour away. The
band between the two is deliberately in neither: a twenty-minute break
is not a re-queue and not a rest, and forcing it into one side would
fill both with the least meaningful games.

## Which heroes am I actually on?

**Matches → dossier → Effective hero pool, Hero trend lines.**

*Effective hero pool* answers whether a hero list is a pool or one pick
with company: it reports how many heroes an even spread would need to
look like yours, weighted by time played, and names the hero past half
your time when there is one. Heroes whose play time could not be read
are named too — a spread measured over three of eight is a different
claim from one over all eight.

*Hero trend lines* draws each hero's rolling win rate beside their name.
A hero you just picked up and a hero you have been losing on for a month
print the same 52%; only the shape tells them apart.

## Today's session

While you are playing, the session readout stays up: a running W/L/D
for the current session, updating as screenshots land. It clears itself
when the session does — a gap long enough to count as a new session
starts a new count rather than adding to yesterday's.

Sessions are also a grouping option in the leaves list, so a finished
session can be read back the same way you watched it.

**The live rail** is the same tally on every tab, plus the one thing the
others do not carry: the rank you are on. It is **off by default** —
turn it on in *Settings → Appearance → Live session banner* — because
four surfaces already spell a session tally and a fifth is your call,
not ours. Dismissing it dismisses that session, not that moment: the
next game does not bring it back.

## Keeping a season

**Compare → Save recap of A.**

A season recap is one HTML file: the record, where the climb started and
ended, the heroes and maps behind it. It opens in any browser with the
network off, forever — nothing in it reaches out — so it keeps as well
as a screenshot does, and reads better.

Any past season, one pick away. When a season rolls over, the Compare
tab offers a recap of the one that just ended; that notice is a nudge
onto a page that is always there, not the only way to reach it.

## Next chapter

- **Slice your match history**: [Filtering and grouping](filtering.md)
- **When a screenshot won't parse**: [Unknown screenshots](unknown-screenshots.md)
