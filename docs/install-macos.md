# Installing Recall on macOS

Recall supports macOS on Apple Silicon (M1/M2/M3/M4). Intel Macs are not
currently supported by the pre-built binary.

## 1. Download

Grab `recall-{version}-darwin-arm64.dmg` from the
[GitHub Releases](https://github.com/sound-barrier/recall/releases) page.

## 2. Install: drag to Applications

Open the downloaded `.dmg` and you'll see three things:

- `Recall` — the app bundle
- `Applications` — a shortcut to your Applications folder
- `README.txt` — these same instructions, bundled with the download

Drag `Recall` onto the `Applications` shortcut. Eject the disk (right-click
the Recall icon in Finder's sidebar → **Eject**) and open Applications.

## 3. First launch — approve the app

The `.dmg` is not notarized (notarization requires an Apple Developer
certificate), so macOS will block Recall on first launch. To approve it:

1. Double-click **Recall** in Applications. macOS will refuse to open it and
   show a "cannot be opened" dialog — dismiss it.
2. Open the Apple menu → **System Settings**.
3. Click **Privacy & Security** in the sidebar.
4. Scroll down to the **Security** section.
5. Click **Open Anyway** next to the Recall warning, then confirm in the
   dialog that appears.

You only need to do this once.

> **Terminal alternative** (skips the System Settings dance):
> ```sh
> xattr -d com.apple.quarantine /Applications/Recall.app
> ```
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
Tesseract after Recall is already running, use **Ingest → Engine → Locate
Tesseract…** to point it at the binary.

## 5. Point Recall at your screenshots folder

Overwatch on macOS saves screenshots to:
```
~/Documents/Overwatch/ScreenShots/Overwatch/
```

Go to **Settings → Directories → Change Folder…** and select that path.

## Where Recall stores its data

Settings and the match database live at:
```
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
