# Running Recall Without the Desktop App

By default Recall is a desktop app with its own window. But it can also run as
a plain web server — open a browser on the same machine (or another device on
your network) and get the full match dashboard without installing anything.

**When would you want this?**

- Your gaming PC has no monitor attached most of the time (home lab, headless box).
- You want to check your stats from your phone or a second PC on the same Wi-Fi.
- You're running Recall on a Raspberry Pi or NAS alongside other services.

If you're just playing Overwatch on your PC and want to see your stats, stick
with the desktop app — this page isn't for you.

---

## Starting the server

Two ways to start server mode:

```sh
# Option 1 — dedicated server binary (no desktop window, ever)
./Recall-server

# Option 2 — the same desktop binary, but told to run headless
./Recall --server
./Recall -s          # short form
```

Then open **<http://127.0.0.1:7000>** in any browser. The full Recall UI loads —
same features as the desktop app, just in a browser tab.

## Accessing from another device

By default Recall only listens on `127.0.0.1` (your own machine). To reach it
from your phone or another computer on your network, set the bind address
before starting:

```sh
RECALL_SERVER_ADDR=0.0.0.0:7000 ./Recall-server
```

Then open `http://<your-pc-ip>:7000` from the other device.

> **Heads up:** Recall has no login or password. Anyone on your local network
> can access it when bound to `0.0.0.0`. Only do this on a network you trust.

## Changing the port

The default port is `7000`. Override it the same way:

```sh
RECALL_SERVER_ADDR=127.0.0.1:8080 ./Recall-server
```

## Choosing a profile per launch

Both binaries support `--profile=<name>` to scope a single launch to
a specific profile. The named profile is auto-created if it doesn't
exist, and it becomes the active profile from then on (subsequent
launches without `--profile` resume on the same one).

```sh
./Recall-server --profile=alt
./Recall --server --profile=stream
```

Use this when you want to spin up a one-off session against an alt
account without going through the masthead chip. You can also drive
profile management entirely via the API once the server is up:

```sh
curl http://127.0.0.1:7000/api/v1/profiles
curl -X POST http://127.0.0.1:7000/api/v1/profiles \
  -H 'Content-Type: application/json' \
  -d '{"name":"alt"}'
curl -X PUT http://127.0.0.1:7000/api/v1/profiles/active \
  -H 'Content-Type: application/json' \
  -d '{"name":"main"}'
```

## Running it automatically on startup

**macOS** — create a launchd plist at
`~/Library/LaunchAgents/recall.server.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>             <string>recall.server</string>
  <key>ProgramArguments</key>  <array><string>/usr/local/bin/Recall-server</string></array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>RECALL_SERVER_ADDR</key><string>127.0.0.1:7000</string>
  </dict>
  <key>RunAtLoad</key>         <true/>
  <key>KeepAlive</key>         <true/>
</dict>
</plist>
```

```sh
launchctl load ~/Library/LaunchAgents/recall.server.plist
```

**Linux (systemd)** — create `/etc/systemd/system/recall.service`:

```ini
[Unit]
Description=Recall server
After=network.target

[Service]
ExecStart=/usr/local/bin/recall-server
Environment=RECALL_SERVER_ADDR=127.0.0.1:7000
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl enable --now recall
```

## Outbound hosts to allowlist

The server keeps the boot path off the network — no auto-update
poll, no telemetry. The two hosts it CAN reach are user-triggered
and only when the **Check for updates** flow runs:

| Host | When | Why |
|---|---|---|
| `api.github.com` | User clicks **Check for updates** (in the desktop app's masthead or via `GET /api/v1/system/update`) | Compares the running version to the latest GitHub release, fetches release notes + per-release-tag YAML rosters. |
| `github.com/sound-barrier/recall/releases/...` | User clicks **Apply update** on the Release sub-row | Downloads `recall-<version>-{heroes,maps,screenshot_sources}.yaml` + `.sha256` sidecars. |
| `sound-barrier.github.io` | User clicks **Check for updates** OR **Sync from main** | The live-data channel published by Pages on every push to `main` that touches the parser rosters. Fetched paths: `/recall/data/version.json`, `/recall/data/heroes.yaml` (+ `.sha256`), `/recall/data/maps.yaml` (+ `.sha256`), `/recall/data/screenshot_sources.yaml` (+ `.sha256`). |

On a managed-network deployment, allow `api.github.com`, `github.com`,
and `sound-barrier.github.io` to keep the Update flow functional.
Blocking `sound-barrier.github.io` is graceful — the Sync from main
row hides itself; the Release channel keeps working independently.

---

For running inside a Docker container instead, see [docker.md](docker.md).
