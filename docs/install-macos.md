# Installing Recall on macOS

Recall supports macOS on Apple Silicon (M1/M2/M3/M4). Intel Macs are not
currently supported by the pre-built binary.

## 1. Download

Grab `recall-{version}-darwin-arm64.dmg` from the
[GitHub Releases](https://github.com/sound-barrier/recall/releases) page.

<!--
  Sections 2 + 3 below mirror the README.txt bundled inside the .dmg.
  Source of truth: docs/dmg/README.txt — scripts/release/make-dmg.sh
  copies it into the DMG staging dir during release. Keep this page
  in sync with that file when either changes. The "Terminal
  alternative" callout in section 3 is web-only on purpose (the
  in-DMG copy stays brief).
-->

## 2. Install — drag to Applications

Open the downloaded `.dmg` and you'll see three things:

- `Recall` — the app bundle
- `Applications` — a shortcut to your Applications folder
- `README.txt` — these same instructions, bundled with the download

1. Drag `Recall` onto the `Applications` alias in this window.
2. Eject this disk (right-click the Recall icon in Finder's sidebar →
   **Eject**) and open the Applications folder.

## 3. First launch — approve the app

Recall is not signed by an Apple Developer account, so macOS will block it
on first launch. To approve it:

1. Double-click **Recall** in Applications. macOS will show a "cannot be
   opened" dialog — dismiss it.
2. Open the Apple menu → **System Settings**.
3. Click **Privacy & Security** in the sidebar.
4. Scroll down to the **Security** section.
5. Find the message **"Recall was blocked to protect your Mac"** and click
   the **Open Anyway** button next to it, then confirm in the dialog that
   appears.

You only need to do this once.

> **Terminal alternative** (skips the System Settings dance):
>
> ```sh
> xattr -d com.apple.quarantine /Applications/Recall.app
> ```
>
> Removes the quarantine attribute macOS attaches to downloaded files; the
> next double-click launches normally.

## 4. Install Tesseract 5.x

Recall needs Tesseract to read text from your screenshots. Install it via
Homebrew:

```sh
brew install tesseract
```

If you don't have Homebrew: [brew.sh](https://brew.sh)

Recall auto-detects the Homebrew install path on first launch. If you install
Tesseract after Recall is already running, use **Settings → Engine → Locate
Tesseract…** to point it at the binary.

## 5. Point Recall at your screenshots folder

Overwatch on macOS saves screenshots to:

```text
~/Documents/Overwatch/ScreenShots/Overwatch/
```

Go to **Settings → Directories → Change Folder…** and select that path.

## Where Recall stores its data

Settings and the match database live at:

```text
~/Library/Application Support/Recall/
```

## Verifying your download

Every release ships a `.sha256` companion file. To confirm the download
wasn't corrupted:

```sh
shasum -a 256 --check recall-{version}-darwin-arm64.dmg.sha256
```

`OK` means the file is intact. `FAILED` means re-download it.

## Server binary

A headless server binary (`recall-server-{version}-darwin-arm64.tar.gz`) is
also available if you want to run Recall without the desktop window. See
[docs/server.md](server.md) for setup instructions.
