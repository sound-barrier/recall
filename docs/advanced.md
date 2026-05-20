# Advanced Setup

If you're using the Recall desktop app and just want to see your match stats,
**you don't need anything on this page.** Close this and go play.

These guides are for specific situations that go beyond the default desktop
experience.

---

## 🖥️ Use Recall without the desktop app

**→ [Running as a server](server.md)**

Run Recall headless and access the full dashboard from any browser — on the
same machine or another device on your network (phone, second PC). Useful if
you want to check your stats without opening the app, or if you're running
Recall on a machine without a monitor.

---

## 🐳 Run Recall in Docker

**→ [Running via Docker](docker.md)**

Run Recall inside a container alongside other services on a home lab or NAS.
Includes the pre-built GHCR image, persistent volume setup, and image tag
reference. You almost certainly don't need this unless you already know what
Docker is and run other containers.

---

## 📊 Charts and dashboards

**→ [Metrics & Grafana](grafana.md)**

Connect Recall to a local Grafana dashboard for time-series charts: SR over
time, win rate by hero, damage vs. healing, and "worst maps" tables. Requires
running Prometheus + Grafana alongside Recall — the repo ships a one-command
setup for this via Docker Compose.
