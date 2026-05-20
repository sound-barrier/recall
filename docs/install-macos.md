# Installing Recall on macOS

Recall supports macOS on Apple Silicon (M1/M2/M3/M4). Intel Macs are not
currently supported by the pre-built binary.

## 1. Download

Grab `recall-{version}-darwin-arm64.dmg` from the
[GitHub Releases](https://github.com/sound-barrier/recall/releases) page.

## 2. First launch — bypass Gatekeeper

The `.dmg` is not notarized (notarization requires an Apple Developer
certificate). macOS will block the app on first open. To bypass it:

**Option A (easiest):** Right-click the app in Finder → **Open** → click
**Open** in the dialog. You only need to do this once.

**Option B (Terminal):**
```sh
xattr -d com.apple.quarantine /Applications/Recall-arm64.app
```

**Option C:** Open **System Settings → Privacy & Security**, scroll down, and
click **Open Anyway** after the first blocked launch attempt.

## 3. Install Tesseract 5.x

Recall needs Tesseract to read text from your screenshots. Install it via
Homebrew:

```sh
brew install tesseract
```

If you don't have Homebrew: [brew.sh](https://brew.sh)

Recall auto-detects the Homebrew install path on first launch. If you install
Tesseract after Recall is already running, use **Ingest → Engine → Locate
Tesseract…** to point it at the binary.

## 4. Point Recall at your screenshots folder

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
