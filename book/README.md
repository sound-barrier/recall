# Recall — Quick start

Recall is a desktop app that turns your Overwatch post-match
screenshots into a personal match history you can browse, filter,
and chart. It runs locally — no account, no upload, no telemetry.

This guide gets you from zero to your first parsed match in about
five minutes on Windows. **Mac or Linux player?** See [macOS](install-macos.md)
or [Linux](install-linux.md).

## 1. Download Recall

Grab `recall-{version}-windows-amd64-installer.exe` from the
[GitHub Releases page](https://github.com/sound-barrier/recall/releases).
Pick the newest version at the top.

## 2. Run the installer

Double-click the `.exe` you downloaded:

- Accept the license (Apache 2.0).
- Click **Install** and let it finish.
- The first time you launch it, Windows SmartScreen will say
  *"Windows protected your PC."* That's expected — the app isn't
  signed with the expensive corporate-grade certificate SmartScreen
  expects. Click **More info** → **Run anyway**. You'll only need
  to approve it once per version.

Detailed Windows-specific steps (verifying the download, server
binary, data paths) are in the full [Windows install guide](install-windows.md).

## 3. Install Tesseract OCR

Recall uses [Tesseract](https://github.com/UB-Mannheim/tesseract/wiki),
a free open-source OCR engine, to read your screenshots.

Download the Windows 5.x installer from UB-Mannheim's page:

- [`tesseract-ocr-w64-setup-5.x.x.exe`](https://github.com/UB-Mannheim/tesseract/wiki) — look for the newest 5.x in the list.

Run it with the default options. The default install path is
`C:\Program Files\Tesseract-OCR\tesseract.exe`, which Recall
auto-detects on first launch.

> **Use Tesseract 5.x, not 3.x or 4.x.** Older versions misread the
> Overwatch post-match font. Recall warns you if it detects an
> unsupported version.

## 4. Point Recall at your Overwatch screenshots

Launch Recall. On first run it tries to auto-detect your Overwatch
screenshots folder. If the **Detect** button finds it, you're done
with setup.

Otherwise, set it manually:

1. Go to **Settings → Directories → Screenshots Folder**.
2. Click **Change Folder…**.
3. Pick `Documents\Overwatch\ScreenShots\Overwatch\` (typically
   `C:\Users\<you>\Documents\Overwatch\ScreenShots\Overwatch\`).

## 5. Capture matches in Overwatch

Press **F12** at the end of every match — once on each of these
post-match screens:

| Screen | Required? | What it provides |
|---|---|---|
| **SUMMARY** | ✅ Yes | Map, result, score, heroes played |
| **TEAMS scoreboard** | ✅ Yes | Your eliminations / assists / deaths / damage / healing / mitigation |
| **PERSONAL** | ✅ Yes (one per hero you played) | Detailed hero-specific stats |
| **RANK** | ⭕ Optional (competitive only) | SR change + rank tier |

Overwatch's default screenshot key is F12, but you can rebind it
in **Options → Controls → General → Take Screenshot**.

## 6. Parse the screenshots

Back in Recall:

- **Watch Folder** (recommended): flip on **Parse → Watch Folder**.
  Recall auto-runs the parser ~60 seconds after the last new
  screenshot lands. Set it once and forget it.
- **Manual**: click **Parse → Run Parse** to scan the folder
  on-demand. The button shows a count of new screenshots
  (e.g. *Run Parse · 5*).

Parsed matches show up on the **Matches** tab. Click a card to
expand for damage / healing / per-hero stats.

That's it. You're using Recall.

---

## What to read next

- **[How it works](how-it-works.md)** — the parse pipeline +
  what each screenshot type contributes.
- **[Settings reference](settings-reference.md)** — every Recall
  setting explained, with screenshots.
- **[Filtering and grouping](filtering.md)** — slice your match
  history by hero, map, role, date, etc.
- **[Unknown screenshots](unknown-screenshots.md)** — what to do
  when a screenshot didn't match a known map.

## Other platforms

- [Installing on macOS](install-macos.md)
- [Installing on Linux](install-linux.md)

## Power-user features (most players can skip these)

- [Run without the desktop app](server.md) — browser access on a
  remote machine.
- [Run in Docker](docker.md) — containers, home lab, NAS.
- [Charts & Dashboards](grafana.md) — SR over time + win-rate
  charts via Grafana.

## Getting help

- [Bug reports and feature requests](feedback.md) — issue templates
  for both, plus how to attach a screenshot that misparsed.
