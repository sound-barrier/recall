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
**Ingest → Engine → Locate Tesseract…** to point it at the binary.

> **Don't use Tesseract 3.x or 4.x.** Those releases predate the
> Overwatch post-match font and misread "ELIMINATIONS" / "ASSISTS" /
> "DEATHS" reliably. Recall flags older versions in the Engine row,
> but the parse-accuracy hit is the real reason to upgrade.

## 5. Point Recall at your screenshots folder

Overwatch on Windows saves screenshots to:

```text
%USERPROFILE%\Documents\Overwatch\ScreenShots\Overwatch\
```

(typically `C:\Users\<you>\Documents\Overwatch\ScreenShots\Overwatch\`)

Go to **Settings → Directories → Change Folder…** and select that
path. The Watch toggle on the **Ingest** tab makes Recall auto-parse
new screenshots as Overwatch writes them.

## Where Recall stores its data

Settings and the match database live at:

```text
%AppData%\Recall\
```

(typically `C:\Users\<you>\AppData\Roaming\Recall\`)

To wipe and start fresh: close Recall, delete the folder, restart.

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

## Server binary (advanced)

A headless server binary
(`recall-server-{version}-windows-amd64.exe`) is also available if
you want to run Recall without the desktop window. See
[Run without the desktop app](server.md) for setup.
