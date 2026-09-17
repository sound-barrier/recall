# Installing Recall on Windows

Recall supports Windows 10 (22H2+) and Windows 11 on x64 hardware. The
desktop app ships as an NSIS installer (`.exe`) that has no Windows
code-signing certificate, so Windows SmartScreen will prompt for
confirmation on first run — see section 3 below for the SmartScreen
approval dance. From the first signed release on, each release is also
signed with Recall's own release key, which you can check yourself (see
[Verifying your download](#verifying-your-download)).

## 1. Download

Grab `recall-{version}-windows-amd64-installer.exe` from the
[GitHub Releases](https://github.com/sound-barrier/recall/releases) page.
That's the file to download — the release also carries a bare
`recall-{version}-windows-amd64.exe`, which exists only for Recall's
in-app updater to fetch; you don't run it directly.

## 2. Install — run the installer

Double-click the downloaded `.exe`. NSIS walks you through:

- Accept the license (Apache-2.0).
- Pick an install path — the default is
  `%LocalAppData%\Programs\Recall\recall.exe`
  (e.g. `C:\Users\<you>\AppData\Local\Programs\Recall`). This is a
  **per-user** install: no administrator prompt, and it's the location
  Recall updates itself into (see [Staying up to date](#staying-up-to-date)).
- Click **Install** and let it copy.

When the installer finishes, Recall is available from the Start Menu
and on the desktop (if you left the shortcut checkbox ticked).

> **Upgrading from an older (pre-per-user) install?** Recall used to
> install machine-wide under `C:\Program Files`. The new installer
> detects that older copy and removes it automatically — Windows will
> ask for administrator permission **once** during that first upgrade
> so it can clear the old Program Files copy. Your data is untouched
> (it lives under `%AppData%\Recall`, not the program folder). If you
> decline the prompt, the install still completes; just remove the old
> "Recall" entry from **Settings → Apps** when convenient.

## 3. First launch — approve SmartScreen

Recall's releases carry a build attestation from GitHub and, from the
first signed release on, a signature from the project's own release key
that Recall's updater checks too. Both let you check where a file came
from. Neither is a Windows code-signing certificate, which is what
SmartScreen looks for, and the project doesn't have one. So the first
time you double-click `Recall.exe`, Windows will show:

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
> checksum, the release signature and GitHub's build attestation. They
> close the "is this really Recall's release?" gap that SmartScreen's
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

## Staying up to date

Open **About Recall** (the ⋮ menu → About) to check for updates. It
surfaces both Recall releases AND roster patches (new heroes / maps /
capture-tool grammars) the parser ships separately from the binary.
See [Updates & game data](settings-reference.md#updates--game-data)
for the flow and the checksum and signature checks. No silent on-mount
network calls — the check only fires when you open About.

When a new Recall release is available, click **Install update** right
there: Recall downloads the new build, checks it and stages it, then
offers **Restart now to apply**, which swaps it in place under
`%LocalAppData%\Programs\Recall` and relaunches. **Open release page**
is the path when Recall can't update itself, as on a machine-wide
install that predates the per-user move, where the program folder isn't
writable without elevation. It is not a way around **Update not
installed** (below): don't install a refused release from that page.

Before it installs anything, Recall checks that the update is an
official Recall release:

- The release's `SHA256SUMS` file must list the new build's SHA-256
  fingerprint, and the download must match it.
- The build's signature file (`.sig`) must have been made with Recall's
  release key, which is built into the copy of Recall you already have.
  The signature covers the file's name as well as its contents, so an
  older build can't be passed off as a newer one.

If a release fails these checks, About shows **Update not installed**
and nothing on your computer changes. (A download that arrives damaged
shows an error instead, and you can try again.) **Don't install that
release by hand.** Wait for the next release, or check Recall's
[Security advisories](https://github.com/sound-barrier/recall/security/advisories)
page on GitHub.

> Copies of Recall older than the first signed release check only the
> `SHA256SUMS` fingerprint, so the signature check applies to every
> update after that one.
> [SECURITY.md](https://github.com/sound-barrier/recall/blob/main/SECURITY.md)
> explains exactly what the updater trusts and checks.

## Where Recall stores its data

Recall organizes everything by **profile** — each profile (your main
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

One file sits outside the profiles, at
`%AppData%\Recall\window.json`: the app window's size and position.
It is shared across profiles on purpose — switching accounts should
not move your window. Delete it (or use **Settings → 07 / Window →
Reset**) if the window ever ends up somewhere awkward.

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
  `%LocalAppData%\Programs\Recall\Reset-Database.bat` — it ships with
  the app. This is the "clean install" path: no separate download needed.
- **Prefer to download it?** Grab `recall-{version}-Reset-Database.bat`
  from the [Releases](https://github.com/sound-barrier/recall/releases)
  page and double-click it. It has a checksum and a build attestation
  like the installer — verify it the same way (see
  [Verifying your download](#verifying-your-download)).

**Close Recall first.** The script warns you if it's still running, backs
up the database to `…\db\backups\recall-<timestamp>.db`, then asks before
deleting. No admin rights are needed.

| Permanently lost — lives only in the database | Safe — untouched |
|---|---|
| match notes, tags, tagged teammates | your screenshots folder |
| leaver + thrower flags, replay codes | settings (incl. the screenshots path) |
| review state, queue / play-mode overrides | other profiles |
| hidden-match flags | |

To restore a backup, copy the `recall-<timestamp>.db` trio from
`…\db\backups\` back over `recall.db` (and its `-wal` / `-shm`) while
Recall is closed.

> Run `Reset-Database.bat /force` to skip the prompt, or `/nobackup` to
> delete without a backup.

## Verifying your download

Each release lets you check a download up to three ways: releases from
before signed updates have no signature, so they skip the second. All
three are optional; the first takes a few seconds and needs nothing
extra.

### Is the file intact? (checksum)

Every release ships a `.sha256` companion file. PowerShell can verify
the download against it:

```powershell
$expected = (Get-Content recall-{version}-windows-amd64-installer.exe.sha256).Split(' ')[0]
$actual   = (Get-FileHash recall-{version}-windows-amd64-installer.exe -Algorithm SHA256).Hash.ToLower()
if ($expected -eq $actual) { 'OK' } else { 'MISMATCH' }
```

`OK` means the file is intact. `MISMATCH` means re-download it. A
checksum says nothing about who made the file: whoever could replace
the installer could replace its `.sha256` too. The next two checks
cover that.

### Did Recall's release key sign it? (signature)

The installer and the updater exe each come with a `.sig` file: the
same signature Recall's updater checks before it installs an update.
Releases from before signed updates have no `.sig` files.

To check a signature you need a bash shell with OpenSSL 3, such as Git
Bash or WSL (run `openssl version` to check). In the folder holding
your download and its `.sig` file:

1. Download Recall's public key for that release and check its
   fingerprint:

   ```sh
   curl -fsSLO https://raw.githubusercontent.com/sound-barrier/recall/v{version}/pkg/updatesig/public_key.pem
   openssl pkey -pubin -in public_key.pem -outform DER | openssl dgst -sha256
   ```

   The output must end with
   `f0a7689b393a24397d4a230e09e53101cdfe401ade3793ab658ebfa9efbf6761`,
   the fingerprint published in
   [SECURITY.md](https://github.com/sound-barrier/recall/blob/main/SECURITY.md).

2. Check the installer:

   ```sh
   name=recall-{version}-windows-amd64-installer.exe
   { printf 'recall-update-signature-v1\n%s\n' "$name"; openssl dgst -sha256 -binary "$name"; } > msg.bin
   openssl pkeyutl -verify -pubin -inkey public_key.pem -rawin -in msg.bin -sigfile "$name.sig"
   ```

   For the updater exe, set `name=recall-{version}-windows-amd64.exe`
   and run the last two lines again.

`Signature Verified Successfully` means Recall's release key signed
that exact file. `Signature Verification Failure` means don't run it.
The signature covers the file's name, so the file must keep the exact
name it was published under: rename a copy your browser saved as
`recall-… (1).exe` back first.

### Which workflow built it? (attestation)

GitHub records a build attestation for each release file (all but the
attestation bundle itself), naming the workflow and tag that produced
it. To check one, install the [GitHub CLI](https://cli.github.com/)
2.68.0 or newer, sign in with `gh auth login`, and run:

```powershell
gh attestation verify recall-{version}-windows-amd64-installer.exe `
  --repo sound-barrier/recall `
  --signer-workflow sound-barrier/recall/.github/workflows/release.yml `
  --source-ref refs/tags/v{version}
```

`✓ Verification succeeded!` means the file was built by Recall's
`release.yml` workflow running on the `v{version}` tag.

To skip signing in, download the release's
`recall-{version}.intoto.jsonl` too and add
`--bundle recall-{version}.intoto.jsonl` to the same command. It still
needs `--repo`, and it still downloads Sigstore's trusted root, so it
is not an offline check. Releases from before signed updates have no
bundle file, so for those you sign in.

An attestation shows which workflow file and tag built a file, but it
cannot tell a reviewed workflow from an edited one. The signature check
above is the one that needs Recall's release key, which only an
approved release run can use.

The checksum and attestation checks work on the reset helper too —
swap in `recall-{version}-Reset-Database.bat` (it ships its own
`.sha256` and is attested alongside the installer). It has no `.sig`.
