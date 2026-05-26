# Settings reference

Every knob in Recall, what it does, and when to touch it. Recall has
two configuration surfaces:

- **Settings (01)** — everything you set up. Folders, Tesseract,
  theme, calendar, backup + restore, plus a collapsible Advanced
  section for power-user controls.
- **Parse (02)** — the operational tab. Watch Folder toggle + the
  Run Parse button. That's the whole tab — nothing to configure here.

Persistence: every setting saves to `settings.json` in your OS user-
config dir (see [How it works → Where things live on disk](how-it-works.md#where-things-live-on-disk))
the moment you change it. No "Save" button.

## Settings tab

### 01 / Directories

#### Screenshots Folder

The folder Recall watches for new Overwatch screenshots.

On first launch, Recall tries to auto-detect the default Overwatch
screenshots location on your platform. If it lands on the right path,
you don't need to touch this. Otherwise:

- **Detect** — re-runs the auto-detect (handy after you move an
  Overwatch install).
- **Change Folder…** — opens the system folder picker so you can
  point at any directory.

The platform defaults Recall looks for:

- Windows: `%USERPROFILE%\Documents\Overwatch\ScreenShots\Overwatch\`
- macOS: `~/Documents/Overwatch/ScreenShots/Overwatch/`
- Linux (Steam Proton): `~/.steam/steam/steamapps/compatdata/2357570/pfx/drive_c/users/steamuser/Documents/Overwatch/ScreenShots/Overwatch/`

You can point Recall at any directory — useful if you keep
screenshots in a synced folder (Dropbox, OneDrive, iCloud Drive) or
want to feed it screenshots from a friend's matches.

Changing the folder while **Watch Folder** is armed restarts the
watcher against the new directory; no manual restart needed.

#### Data Location

Read-only paths showing where Recall stores its database and
`settings.json` on this machine. Each path has a **Copy** button;
in the desktop app, **Open** opens the directory in your OS file
manager.

### 02 / Engine

#### Tesseract Binary

Path to the [Tesseract OCR](https://github.com/tesseract-ocr/tesseract)
binary Recall shells out to. The status row underneath shows:

- **Detected** (green) + version + path: Recall found a working
  Tesseract. You're good.
- **Not Found** (red) + the OS error: Recall looked at the default
  install path for your OS and didn't find anything. Click
  **Locate Tesseract…** to point it at the real binary.

Recall auto-detects on first launch:

- Windows (UB-Mannheim default): `C:\Program Files\Tesseract-OCR\tesseract.exe`
- macOS Apple Silicon: `/opt/homebrew/bin/tesseract`
- macOS Intel: `/usr/local/bin/tesseract`
- Linux (apt-installed): `/usr/bin/tesseract`

**Version compatibility:** Tesseract 5.x is the supported series.
Versions 3.x and 4.x predate the Overwatch post-match font and
misread "ELIMINATIONS" / "ASSISTS" / "DEATHS" reliably. Recall shows
an amber "not officially supported" warning under the status row
when it detects 3.x or 4.x — parsing still runs but you'll see lower
accuracy.

If your install path has drifted (e.g. you moved from Intel to Apple
Silicon Homebrew), the **Use default** link under the path row
resets to the platform default in one click.

### 03 / Appearance

#### Theme

Two preview cards: **Day** (light palette, cream + brand orange) or
**Night** (dark palette, off-black + brand orange). Click a card to
apply; the active card shows an orange ring. Recall remembers the
choice across launches.

### 04 / Calendar

#### First Day of Week

Anchors the **Week of …** headers on the Matches tab when you group
by week. Seven-cell grid (S / M / T / W / T / F / S). The selected
cell fills orange; a caption underneath spells it out ("Weeks begin
on Sunday") so the two-T / two-S ambiguity is always resolved.
Matches the cultural default in your region:

- US, Canada, Japan: Sunday
- Most of Europe + ISO 8601: Monday
- Middle East: Saturday

Doesn't change which matches appear in which week — Recall
calculates the week boundary from this setting, so a Tuesday match
shows up under either "Week of Sunday Jan 12" or "Week of Monday Jan
13" depending on what you picked.

### 05 / Backup & Restore

#### Export Data

Download a portable backup of every parsed match. Two formats:

- **JSON** — the canonical Recall format. Smallest, round-trips
  losslessly through Import. One file.
- **CSV** — a ZIP archive of one CSV per database table, for opening
  in Excel / Google Sheets.

Settings and screenshots aren't included — only parsed match
records. A confirmation chip flashes the save path once the export
completes.

#### Import Data

Restore a previously-exported backup. JSON and CSV (the same ZIP
format Export emits) both work — Recall sniffs the content type
automatically.

Two-step confirm: clicking **Import Backup…** arms the action and
turns the row's stripe red, then **Choose File…** opens the file
picker. **Replaces** the current database — local matches that
aren't in the backup will be lost. Cancel button next to it backs
out without touching anything.

### 06 / Advanced

A collapsible section, closed by default. Contains power-user
controls most players never need to touch.

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
  **Parse → Run Parse** (which re-reads any unparsed screenshots) —
  not a full wipe.
- You think a single match record is wrong. Re-capture the SUMMARY
  and PERSONAL screens for that match into the folder; Recall will
  merge them into the existing record without duplicating it.

## Parse tab

### Watch Folder

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
(SUMMARY → TEAMS → PERSONAL × hero count, ~5–15 seconds of tabbing).
The whole batch lands as one match record instead of several
"partial-data" rows.

### Run Parse

Big primary button. Same parse logic as the watcher but on demand —
useful if you just dragged screenshots into the folder from another
machine, want to re-parse after upgrading Tesseract, or simply
prefer not to leave the watcher armed.

The button shows the count of new screenshots in the folder
(**Run Parse · 5**) and disables itself when there's nothing new to
parse. Re-running it against the same screenshots is idempotent —
Recall stores which files it's already seen, so duplicates don't
create duplicate matches.

The status line below shows either:

- **Last run · X ago · N records on record** — when there are no
  new screenshots to process.
- **All screenshots already parsed — nothing new in the folder.** —
  same idea, sterner.
- **Blocked — needs Tesseract.** — Engine row needs fixing first;
  click **Fix in Settings →** to jump to **Settings → Engine**.

While parsing, the button reads **Parsing…** and a progress panel
expands under the row showing per-file status. Click the chevron to
collapse it down to a single progress bar.

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
