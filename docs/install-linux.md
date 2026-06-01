# Installing Recall on Linux

Recall provides Linux/amd64 binaries. ARM64 Linux is not currently supported
by the pre-built binary — you can [build from source](../CONTRIBUTING.md#building).

## 1. Download

Grab one of the following from the
[GitHub Releases](https://github.com/sound-barrier/recall/releases) page:

| Format | Install to |
|---|---|
| `recall-{version}-linux-amd64.deb` | `/usr/local/bin/recall` (via dpkg) |
| `recall-{version}-linux-amd64.tar.gz` | Extract anywhere |

```sh
# .deb (Ubuntu / Debian)
sudo dpkg -i recall-{version}-linux-amd64.deb

# tar.gz — extract and run directly
tar -xzf recall-{version}-linux-amd64.tar.gz
./recall
```

## 2. Install Tesseract 5.x

Recall needs Tesseract to read text from your screenshots.

**Ubuntu 22.04 or later:**

```sh
sudo apt install tesseract-ocr
```

**Ubuntu 20.04 (ships 4.x — needs PPA):**

```sh
sudo add-apt-repository ppa:alex-p/tesseract-ocr5
sudo apt update
sudo apt install tesseract-ocr
```

**Fedora / RHEL:**

```sh
sudo dnf install tesseract
```

Recall auto-detects `/usr/bin/tesseract` on first launch. If you installed
Tesseract elsewhere, use **Settings → Engine → Locate Tesseract…** to point it
at the binary.

## 3. Point Recall at your screenshots folder

Overwatch on Linux (via Lutris or Heroic) typically saves screenshots to:

```text
~/Games/overwatch/drive_c/users/<username>/Documents/Overwatch/ScreenShots/Overwatch/
```

The exact path varies by launcher. Go to **Settings → Directories →
Change Folder…** and select the correct path.

## Where Recall stores its data

Recall organises everything by **profile** — each profile (your main
account, alts, anything) gets its own settings + match database.
The install root is:

```text
~/.config/recall/
```

(or `$XDG_CONFIG_HOME/recall/` if you have `XDG_CONFIG_HOME` set)

Inside it, the default `main` profile's data lives at:

```text
~/.config/recall/profiles/main/
  ├── settings.json
  └── db/recall.db
```

The masthead chip lets you create more profiles + switch between
them; each one gets its own sibling directory under `profiles/`.

## Verifying your download

Every release ships a `.sha256` companion file:

```sh
sha256sum --check recall-{version}-linux-amd64.tar.gz.sha256
```

`OK` means the file is intact. `FAILED` means re-download it.

## Server binary and container image

A headless server binary (`recall-server-{version}-linux-amd64.{deb,tar.gz}`)
and a Docker image (`ghcr.io/sound-barrier/recall-server:latest`) are also
available. See [docs/server.md](server.md) and [docs/docker.md](docker.md).
