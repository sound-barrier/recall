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

Then open **http://127.0.0.1:7000** in any browser. The full Recall UI loads —
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

---

For running inside a Docker container instead, see [docker.md](docker.md).
