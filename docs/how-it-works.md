# How Recall works

Recall turns a folder of Overwatch screenshots into a personal,
filterable match history. This page walks through the pipeline so the
[Settings reference](settings-reference.md),
[Filtering guide](filtering.md), and
[Unknown screenshots](unknown-screenshots.md) chapters make sense in
context.

## What it looks like

<table>
<tr>
<th align="left">Matches view</th>
<th align="left">Match detail panel</th>
</tr>
<tr>
<td valign="top" width="50%">
<a href="screenshots/matches-view.png"><img src="screenshots/matches-view.png" alt="Recall Matches tab with a dossier headline, Campaign Log heatmap, and a compact list of parsed matches" width="100%"></a>
<sub>The Matches tab — dossier headline (W/L/D, win rate, top maps/heroes, active-clause chips), Campaign Log heatmap + brushable sparkline, and the compact leaf-row list below.</sub>
</td>
<td valign="top" width="50%">
<a href="screenshots/match-detail-panel.png"><img src="screenshots/match-detail-panel.png" alt="Recall right-side detail panel — per-match dossier with the Match Journal, stats grid, Heroes Played, and source screenshots" width="100%"></a>
<sub>Clicking a row (or pressing <code>e</code>) slides in the per-match dossier — annotation, stats, rank update, heroes played, source screenshots.</sub>
</td>
</tr>
</table>

The rest of this chapter is the pipeline that fills those views.

## The pipeline in one paragraph

You play a comp match. After it ends, you tab through the post-match
screens (SUMMARY, TEAMS scoreboard, PERSONAL tab) and press the
in-game **Print Screen** binding on each. Overwatch saves the PNG
files into your screenshots folder. Recall watches that folder, runs each
new PNG through Tesseract OCR to read the on-screen text, classifies
it by screenshot type (rank / summary / scoreboard / personal),
extracts the fields it can (map, mode, hero, eliminations, deaths,
SR change, …), and folds 3–5 screenshots from the same match into
one match record in its local database. The Matches tab then shows
that record alongside every other match you've parsed — filterable by hero,
map, mode, win/loss, and any combination of date range or
play-time threshold.

## The four screenshot types

Recall recognises four post-match screen layouts in Overwatch 2.
You don't need to capture all four for a match to land — but more
captures = more fields populated:

| Screen | What it shows | Fields Recall extracts |
|---|---|---|
| **SUMMARY** | Match overview, top heroes, performance summary | Map, mode, type (control/push/escort/…), role, primary hero, victory/defeat, final score, date, finish time, game length, performance per-10-min averages |
| **TEAMS scoreboard** | Both teams' stats side by side | Eliminations / assists / deaths, damage, healing, mitigation |
| **PERSONAL** | One hero's detailed stat grid (3×3) | Hero-specific stats (e.g. Juno's `pulsar_torpedoes_damage`, Mizuki's `binding_chain_accuracy`) |
| **RANK** | Competitive ladder badge + per-hero SR | Current rank tier, per-hero SR, recent change |

If you swapped heroes mid-match, Overwatch shows a separate PERSONAL
tab per hero — Recall captures each one and merges them into the
same match record. The first hero in the SUMMARY's "Heroes Played"
list becomes the match's primary hero in filters and card headers.

### What each type looks like

Real examples from Recall's parser-regression fixture set — the same
PNG files live under `testdata/` in the repo and are the inputs
`TestParseScreenshot_GoldenFiles` runs against on every commit. Click
any image for the full-resolution source.

<table>
<tr>
<th align="left">SUMMARY</th>
<th align="left">TEAMS scoreboard</th>
</tr>
<tr>
<td valign="top" width="50%">
<a href="testdata/Overwatch%202%20Screenshot%202026.05.24%20-%2022.36.31.03.png"><img src="testdata/Overwatch%202%20Screenshot%202026.05.24%20-%2022.36.31.03.png" alt="SUMMARY tab — Antarctic Peninsula, Juno, comp victory" width="100%"></a>
<sub>Antarctic Peninsula · comp victory 2-1. The map + game type + heroes-played list + per-10-min averages all come from this tab.</sub>
</td>
<td valign="top" width="50%">
<a href="testdata/Overwatch%202%20Screenshot%202026.05.24%20-%2022.36.33.04.png"><img src="testdata/Overwatch%202%20Screenshot%202026.05.24%20-%2022.36.33.04.png" alt="Post-match TEAMS scoreboard with both teams' stats" width="100%"></a>
<sub>Same match. Eliminations / assists / deaths / damage / healing / mitigation come from the highlighted row + the right-hand stat panel.</sub>
</td>
</tr>
<tr>
<th align="left" colspan="2">PERSONAL (one per hero played)</th>
</tr>
<tr>
<td valign="top" width="50%">
<a href="testdata/Overwatch%202%20Screenshot%202026.05.24%20-%2022.36.34.50.png"><img src="testdata/Overwatch%202%20Screenshot%202026.05.24%20-%2022.36.34.50.png" alt="PERSONAL tab — Juno hero-specific stats" width="100%"></a>
<sub>Juno's PERSONAL tab. The 3×3 grid populates hero-specific stats (pulsar torpedoes damage, orbital ray healing, players saved, weapon accuracy).</sub>
</td>
<td valign="top" width="50%">
<a href="testdata/Overwatch%202%20Screenshot%202026.05.24%20-%2022.36.36.31.png"><img src="testdata/Overwatch%202%20Screenshot%202026.05.24%20-%2022.36.36.31.png" alt="PERSONAL tab — Mizuki hero-specific stats from a hero-swap match" width="100%"></a>
<sub>Mizuki's PERSONAL tab from the same match — the player swapped from Juno (67% played) to Mizuki (33% played). Recall captures one PERSONAL per hero and merges them into the same match record.</sub>
</td>
</tr>
</table>

> **RANK screen** — no example in the test corpus yet. The RANK tab
> shows your current competitive rank tier + per-hero SR + the recent
> change; Recall parses it the same way as the others when it's
> present. Capture one and drop it into `testdata/` with a sidecar
> golden — see [testdata/README.md](https://github.com/sound-barrier/recall/blob/main/testdata/README.md)
> for the curate-and-commit flow.

## Expected workflow

### First-time setup (about 2 minutes)

1. **Install Recall** for your OS — [macOS](install-macos.md),
   [Linux](install-linux.md), or [Windows](install-windows.md).
2. **Install Tesseract 5.x** — the OCR engine Recall shells out to.
   Each install guide has the per-platform command (Homebrew on
   macOS, apt on Linux, UB-Mannheim installer on Windows).
3. **Point Recall at your screenshots folder.** Open Recall and go
   to **Settings → Directories → Change Folder…**. The default
   Overwatch path on each OS is in the install guide.

That's it for setup. **Settings → Engine** should now show
**Detected** with a green dot and Tesseract's version.

### Day-to-day

1. **Play matches and capture post-game screens.** Bind a screenshot
   key in Overwatch (Options → Controls → Take Screenshot — most
   people use **Print Screen** or **F12**). After every comp match,
   tab through SUMMARY → TEAMS → PERSONAL × however many heroes you
   played → optionally RANK, pressing the key on each.
2. **Recall picks them up.** If you've armed
   **Parse → Watch Folder** (the recommended setting), Recall
   debounces 60 seconds after the last new PNG and auto-parses the
   batch. Otherwise click **Parse → Run Parse** when you're ready.
3. **Browse the Matches tab.** Each match appears as a card with map,
   primary hero, e/a/d, and result. Click a card (or the chevron, or
   press `e` on the focused row) to open the **detail panel** — a
   slide-in surface on the right with the full readout: When · Final
   Score · Parsed, your match journal (notes / replay / squad / tags),
   the leaver chooser, the Match Stats grid, a Rank Update card (when
   a rank screenshot was captured for this match), Heroes Played, and
   the source screenshots. Use `←` / `→` to step through the filtered
   list without closing the panel; `↑` / `↓` scroll inside the panel.
   Click a source screenshot inline-preview to enlarge it fullscreen
   (× / Esc / backdrop click closes). Press `?` for the full
   keyboard cheatsheet. Use the [Narrow this set panel](filtering.md)
   to slice the view by any combination of hero, map, role, result,
   date, tag, or minimum play time.

### Optional: time-series charts

The **Settings → Advanced → Stream to Grafana** toggle exposes match
history on `localhost:9091/metrics` so the bundled Prometheus +
Grafana stack can scrape it. See
[Charts & Dashboards](grafana.md) and
[Run in Docker](docker.md) for the wiring.

## What Recall doesn't do

- **No upload, no account, no telemetry.** Recall is fully local.
  Screenshots stay on your disk, the database is a single SQLite
  file under your OS's user-config directory. There is no Recall
  server to phone home to.
- **No name extraction.** The parser doesn't try to read BattleTags
  off scoreboards — only your own stats are kept. If you blur or
  crop other players' tags before sharing a screenshot, the parser
  is unaffected.
- **No real-time stream.** Recall reads PNG files that Overwatch has
  already written; it doesn't hook into the game process or read
  the game's network traffic.

## Where things live on disk

Recall keeps state in your OS's user-config directory. The
install-wide base directory:

| OS | Base directory |
|---|---|
| macOS | `~/Library/Application Support/Recall/` |
| Linux | `~/.config/recall/` (or `$XDG_CONFIG_HOME/recall/`) |
| Windows | `%AppData%\Recall\` |

Inside the base directory, Recall organises everything by
**profile**. Each profile is a separate OW account (or alt, or
any logical grouping you want) with its own settings and match
database — switching profiles via the masthead chip swaps every
data surface (dossier, heatmap, Archive) to that profile's history.

```text
<base>/
├── profiles.json        ← which profile is active + the list
└── profiles/
    ├── main/            ← the default profile (created on first launch)
    │   ├── settings.json
    │   └── db/recall.db
    └── alt/             ← any profile you create from the chip
        ├── settings.json
        └── db/recall.db
```

Inside each profile directory:

- `settings.json` — the screenshots folder, Tesseract path, theme,
  toggle states. One JSON object, human-editable if you want.
  Each profile has its own; switching profiles loads a different
  file.
- `db/recall.db` — SQLite database of every parsed match for that
  profile. Single-file; back up by copying.

Wiping a profile's `db/recall.db` (or using **Settings → Advanced
→ Clear Parse Database** while that profile is active) deletes
match history for that profile but leaves screenshots and
settings alone. Re-running Parse against the same screenshot
folder rebuilds it from scratch.

You can scope a single launch to a specific profile via
`--profile=<name>` on the binary — useful for opening an alt
account once without changing the persisted active profile.

## Next chapter

- **Configure Recall**: [Settings reference](settings-reference.md)
- **Slice your match history**: [Filtering and grouping](filtering.md)
- **Triage parse failures**: [Unknown screenshots](unknown-screenshots.md)
