# Installing Recall on Windows

Recall supports Windows 10 (22H2+) and Windows 11 on x64 hardware. The
desktop app ships as a signed-by-CI but not-EV-signed NSIS installer
(`.exe`), so Windows SmartScreen will prompt for confirmation on first
run — see section 3 below for the SmartScreen approval dance.

## 1. Download

Grab `recall-{version}-windows-amd64-installer.exe` from the
[GitHub Releases](https://github.com/sound-barrier/recall/releases) page.

## 2. Install — run the installer

Double-click the downloaded `.exe`. NSIS walks you through:

- Accept the licence (Apache-2.0).
- Pick an install path — the default is
  `C:\Program Files\Recall\Recall.exe`. Leave it alone unless you have
  a specific reason to relocate it; the path is what Recall's Start
  Menu shortcut points at.
- Click **Install** and let it copy.

When the installer finishes, Recall is available from the Start Menu
and on the desktop (if you left the shortcut checkbox ticked).

## 3. First launch — approve SmartScreen

Recall is signed by GitHub Actions' OIDC keyless flow, which is good
enough for [`gh attestation verify`](https://cli.github.com/manual/gh_attestation_verify)
but **not** good enough to silence Windows SmartScreen on its own.
SmartScreen wants an **EV** (Extended Validation) code-signing
certificate — those cost USD 300+/year and the project doesn't have
one. So the first time you double-click `Recall.exe`, Windows will
show:

> **Windows protected your PC**
> Microsoft Defender SmartScreen prevented an unrecognized app from
> starting. Running this app might put your PC at risk.

To approve it:

1. Click **More info** in the SmartScreen dialog.
2. A **Run anyway** button appears — click it.

You only need to do this once per installed version. After Windows has
"seen" the binary, subsequent launches skip the prompt.

> **Verifying the binary before you trust it** — section
> [Verifying your download](#verifying-your-download) below covers the
> SHA256 check + the GitHub-attested build provenance. Both close the
> "is this the binary CI actually built?" gap that SmartScreen's
> prompt opens.

## 4. Install Tesseract 5.x

Recall needs Tesseract to read text from your screenshots. Download
the 5.x installer from UB-Mannheim:

- [tesseract-ocr-w64-setup-5.5.0.20241111.exe](https://github.com/UB-Mannheim/tesseract/wiki)
  (or whichever is the latest 5.x in the list)

Run it with the default options. The default install path is:

```text
C:\Program Files\Tesseract-OCR\tesseract.exe
```

Recall auto-detects this path on first launch. If you installed
Tesseract somewhere else (or earlier installations dropped it under
`C:\Program Files (x86)\Tesseract-OCR\…`), use
**Settings → Engine → Locate Tesseract…** to point it at the binary.

> **Don't use Tesseract 3.x or 4.x.** Those releases predate the
> Overwatch post-match font and misread "ELIMINATIONS" / "ASSISTS" /
> "DEATHS" reliably. Recall flags older versions in the Engine row,
> but the parse-accuracy hit is the real reason to upgrade.

## 5. Point Recall at your screenshots folder

Recall's first-run Settings hero shows a **2 × 2 picker grid**
naming each canonical Windows capture source. A green dot on a card
means that folder exists on your machine; one click sets it as the
watched directory.

| Card | Path | Filename shape |
|---|---|---|
| **Nvidia Overlay** | `%USERPROFILE%\Videos\NVIDIA\Overwatch 2` | `Overwatch 2 Screenshot YYYY.MM.DD - HH.MM.SS.ff.png` |
| **OW PrntScn default** | `%USERPROFILE%\Documents\Overwatch\ScreenShots\Overwatch` (+ OneDrive variant) | `ScreenShot_YY-MM-DD_HH-MM-SS-fff.jpg` |
| **Win Snip tool** | `%USERPROFILE%\Pictures\Screenshots` (+ OneDrive variant) | `Screenshot YYYY-MM-DD HHMMSS.png` |
| **Steam install** | `<SteamInstall>\userdata\<id>\760\remote\<OW-app-id>\screenshots` | `YYYYMMDDHHMMSS_N.jpg` (Steam's in-game F12) |

If you use something else (a third-party tool, a synced cloud
folder, a USB stick), use the **Pick a different folder…** tile
below the grid — opens the standard Windows folder picker.

The **Watch Folder** toggle on the **Parse** tab makes Recall
auto-parse new screenshots as Overwatch (or your capture tool)
writes them.

After install, the masthead's **Check for updates** button surfaces
both Recall releases AND roster patches (new heroes / maps / capture-
tool grammars) the parser ships separately from the binary. See
[Updates & game data](settings-reference.md#updates--game-data) for
the modal flow + the SHA-256 verification path. No silent on-mount
network calls — the check only fires when you click.

## Where Recall stores its data

Recall organises everything by **profile** — each profile (your main
account, alts, anything) gets its own settings + match database.
The install root is:

```text
%AppData%\Recall\
```

(typically `C:\Users\<you>\AppData\Roaming\Recall\`)

Inside it, the default `main` profile's data lives at:

```text
%AppData%\Recall\profiles\main\
  ├── settings.json
  └── db\recall.db
```

The masthead chip lets you create more profiles + switch between
them; each one gets its own sibling directory under `profiles\`.

To wipe a single profile: close Recall, delete that profile's
folder under `profiles\`, restart. To wipe everything, delete the
whole `Recall\` install root. For a guided reset that backs up first,
use the script below.

## Resetting your database (no migrations yet)

Recall has **no schema migrations** before 1.0. When an update changes
the database layout your existing data can become incompatible — and the
fix is to wipe the database. Recall recreates an empty one on next launch
and **re-parses your screenshots folder**, so your matches come back; only
data that lives *only* in the database is lost (table below). You might
also want this for a deliberately clean start or a corrupt database.

A helper script does it safely — it **backs up the database first**, then
deletes it once you confirm. Two ways to run it:

- **Already installed?** Double-click
  `C:\Program Files\recall\Reset-Database.bat` — it ships with the app.
  This is the "clean install" path: no separate download needed.
- **Prefer to download it?** Grab `recall-{version}-Reset-Database.bat`
  from the [Releases](https://github.com/sound-barrier/recall/releases)
  page and double-click it. It's signed + attested like every other
  release asset — verify it the same way (see
  [Verifying your download](#verifying-your-download)).

**Close Recall first.** The script warns you if it's still running, backs
up the database to `…\db\backups\recall-<timestamp>.db`, then asks before
deleting. No admin rights are needed.

| Permanently lost — lives only in the database | Safe — untouched |
|---|---|
| match notes, tags, tagged teammates | your screenshots folder |
| leaver flags, replay codes | settings (incl. the screenshots path) |
| review state, queue / play-mode overrides | other profiles |
| hidden-match flags | |

To restore a backup, copy the `recall-<timestamp>.db` trio from
`…\db\backups\` back over `recall.db` (and its `-wal` / `-shm`) while
Recall is closed.

> Run `Reset-Database.bat /force` to skip the prompt, or `/nobackup` to
> delete without a backup. On macOS / Linux (no `.bat`), close Recall and
> delete `recall.db` (plus `-wal` / `-shm`) under the app-data dir.

## Verifying your download

Every release ships a `.sha256` companion file. PowerShell can verify
the download against it:

```powershell
$expected = (Get-Content recall-{version}-windows-amd64-installer.exe.sha256).Split(' ')[0]
$actual   = (Get-FileHash recall-{version}-windows-amd64-installer.exe -Algorithm SHA256).Hash.ToLower()
if ($expected -eq $actual) { 'OK' } else { 'MISMATCH' }
```

`OK` means the file is intact. `MISMATCH` means re-download it.

For the strongest guarantee that the binary actually came from this
project's CI (not a tampered mirror), install the
[GitHub CLI](https://cli.github.com/) and run:

```powershell
gh attestation verify recall-{version}-windows-amd64-installer.exe `
  --repo sound-barrier/recall
```

This walks the SLSA-provenance attestation that release.yml writes
for every Windows artifact. A passing check means the binary was
produced by a specific commit on `main` by the published GitHub
Actions workflow — not just "the hash matches the .sha256 file"
(which says nothing about who produced the file in the first place).

The same two checks work on the reset helper — swap in
`recall-{version}-Reset-Database.bat` (it ships its own `.sha256` and is
attested alongside the installer).

## Server binary (advanced)

A headless server binary
(`recall-server-{version}-windows-amd64.exe`) is also available if
you want to run Recall without the desktop window. See
[Run without the desktop app](server.md) for setup.
