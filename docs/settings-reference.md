# Settings reference

Every knob in Recall, what it does, and when to touch it. Settings
live on two tabs:

- **Settings (01)** — user-preference knobs you set once.
- **Ingest (02)** — the parse engine + run controls.

Persistence: every setting saves to `settings.json` in your OS user-
config dir (see [How it works → Where things live on disk](how-it-works.md#where-things-live-on-disk))
the moment you change it. No "Save" button.

## Settings tab

### 01 / Directories

#### Screenshots Folder

The folder Recall watches for new Overwatch screenshots. Click
**Change Folder…** to point it at a different directory.

The default Overwatch screenshot path per OS is in the install
guides:

- macOS: `~/Documents/Overwatch/ScreenShots/Overwatch/`
- Linux (Lutris/Heroic): `~/Games/overwatch/drive_c/users/<you>/Documents/Overwatch/ScreenShots/Overwatch/`
- Windows: `%USERPROFILE%\Documents\Overwatch\ScreenShots\Overwatch\`

You can point Recall at any directory — useful if you keep screenshots
in a synced folder (Dropbox, OneDrive, iCloud Drive) or want to feed
it screenshots from a friend's matches.

Changing the folder while the **Watch Folder** toggle is armed
restarts the watcher against the new directory; no manual restart
needed.

### 02 / Appearance

#### Theme

Two-segment toggle: **Day** (light palette, cream + brand orange) or
**Night** (dark palette, off-black + brand orange). Recall remembers
the choice across launches. The toggle lives in the upper-right of
the masthead too, for quick switching without leaving the current
view.

### 03 / Calendar

#### First Day of Week

Anchors the **Week of …** headers on the Matches tab when you group
by week. Seven-segment picker (Sun / Mon / Tue / Wed / Thu / Fri /
Sat). Matches the cultural default in your region:

- US, Canada, Japan: Sunday
- Most of Europe + ISO 8601: Monday
- Middle East: Saturday

Doesn't change which matches appear in which week — Recall calculates
the week boundary from this setting, so a Tuesday match shows up
under either "Week of Sunday Jan 12" or "Week of Monday Jan 13"
depending on what you picked.

## Ingest tab

### 01 / Engine

#### Tesseract Binary

Path to the [Tesseract OCR](https://github.com/tesseract-ocr/tesseract)
binary Recall shells out to. The status row underneath shows:

- **Detected** (green) + version + path: Recall found a working
  Tesseract. You're good.
- **Not Found** (red) + the OS error: Recall looked at the default
  install path for your OS and didn't find anything. Click
  **Locate Tesseract…** to point it at the real binary.

Recall auto-detects on first launch:

- macOS Apple Silicon: `/opt/homebrew/bin/tesseract`
- macOS Intel: `/usr/local/bin/tesseract`
- Linux (apt-installed): `/usr/bin/tesseract`
- Windows (UB-Mannheim default): `C:\Program Files\Tesseract-OCR\tesseract.exe`

**Version compatibility:** Tesseract 5.x is the supported series.
Versions 3.x and 4.x predate the Overwatch post-match font and
misread "ELIMINATIONS" / "ASSISTS" / "DEATHS" reliably. Recall shows
an amber "not officially supported" warning under the status row
when it detects 3.x or 4.x — parsing still runs but you'll see lower
accuracy.

If your install path has drifted (e.g. you moved from Intel to Apple
Silicon Homebrew), the **Use default** link under the path row
resets to the platform default in one click.

### 02 / Parse

#### Watch Folder

Auto-parse new screenshots as they appear in the screenshots folder.
Big switch — **Off** by default, **Armed** when on. Disabled (greyed
out) when Tesseract is not detected.

Behavior when armed:

1. Recall registers a filesystem watch on the screenshots folder.
2. When a new `.png` or `.jpg` lands, Recall starts a 60-second
   timer. Every subsequent new file resets the timer.
3. After 60 seconds of silence, Recall runs Parse against all new
   files in one batch.

The debounce window matches a typical post-match capture session
(SUMMARY → TEAMS → PERSONAL × hero count, ~5–15 seconds of
tabbing). The whole batch lands as one match record instead of
five separate "partial-data" rows.

#### Manual Parse

Big **Run Parse** button. Same parse logic as the watcher but on
demand — useful if you just dragged screenshots into the folder
from another machine, want to re-parse after upgrading Tesseract,
or simply prefer not to leave the watcher armed.

The button shows the count of new screenshots in the folder
(**Run Parse · 5**) and disables itself when there's nothing new
to parse. Re-running it against the same screenshots is idempotent
— Recall stores which files it's already seen, so duplicates don't
create duplicate matches.

The status line below shows either:

- **Last run · X ago · N records on record** — when there are no
  new screenshots to process.
- **All screenshots already parsed — nothing new in the folder.** —
  same idea, sterner.
- **Blocked — needs Tesseract.** — Engine row needs fixing first.

While parsing, the button reads **Parsing…** and a progress panel
expands under the row showing per-file status. Click the chevron to
collapse it down to a single progress bar.

### 03 / Export

#### Stream to Grafana

Expose match history as Prometheus metrics on `localhost:9091/metrics`
so the bundled Prometheus container can scrape it and Grafana can
chart it. **Off** by default — no port is opened until you flip
this.

Toggle states:

- **Off**: no HTTP listener.
- **Live**: HTTP server bound to `127.0.0.1:9091` (loopback only —
  not exposed to your network). Hit
  [`http://localhost:9091/metrics`](http://localhost:9091/metrics)
  in a browser to see the raw output.

What's exposed: per-match samples for eliminations, assists, deaths,
damage, healing, mitigation, result (1/0/0.5 for win/loss/draw),
rank level + SR per hero, percent_played per hero, plus a handful of
hero-specific stats lifted from PERSONAL screens. Every sample
carries the match's `finished_at` timestamp, so Prometheus stores it
at the time the match actually ended (not when it was scraped).

The full Grafana setup — Docker compose stack, dashboards, scrape
config — is in [Charts & Dashboards](grafana.md).

> **Privacy:** the metrics only contain *your* stats — Recall doesn't
> extract other players' names or stats from scoreboards. Even so,
> the port is loopback-only and only a process on your machine can
> reach it. Nothing leaves your computer unless you add a remote
> Prometheus scrape target yourself.

### 04 / Data

#### Clear Parse Database

Permanently delete every parsed match record from the local SQLite
database. Settings and the screenshots folder are untouched — you
can re-parse at any time to rebuild from scratch.

Two-step confirm (the button label changes to **Delete N Records**
in red after the first click). Cancel button next to it to back out.

When to use:

- You want a fresh start.
- A parser upgrade meaningfully changed how fields are extracted
  and you'd rather re-parse everything than live with mixed-version
  rows.
- You're sharing a screenshot bug with the maintainer and want a
  clean reproduction.

When NOT to use:

- You think Recall is showing stale data. The right move is
  **Manual Parse** (which re-reads any unparsed screenshots) — not
  a full wipe.
- You think a single match record is wrong. Re-capture the SUMMARY
  and PERSONAL screens for that match into the folder; Recall will
  merge them into the existing record without duplicating it.

## Sidebar version block (masthead, lower-right)

Not strictly a "setting" but worth knowing about:

- The version chip shows the running Recall version.
- A small dot turns orange when a newer release is available on
  GitHub — click the chip to open the release page.
- "Dev" builds (when running from source) get an info-only chip
  pointing at the latest release for comparison.

## Next chapter

- **Slice your match history**: [Filtering and grouping](filtering.md)
- **Triage parse failures**: [Unknown screenshots](unknown-screenshots.md)
