# Security Policy

## Supported versions

Recall is a small open-source project; only the **latest tagged
release** receives security updates. Older versions are not patched —
upgrade to the latest from
[GitHub Releases](https://github.com/sound-barrier/recall/releases).

| Version | Supported |
|---|---|
| Latest release | ✓ |
| Anything older | ✗ — please upgrade first |

## Reporting a vulnerability

**Do not open a public GitHub issue for a security bug.** Public issues
disclose the bug before there's a fix, which puts everyone at risk.

Instead, file a private advisory:

> <https://github.com/sound-barrier/recall/security/advisories/new>

Or, if you'd rather email, the maintainer's address is in the commit
history (`git log --format='%ae' | sort -u`).

### What to include

The more of this you can provide, the faster the triage:

- **Recall version** affected (and any earlier versions you can confirm
  also affected)
- **Reproduction steps** — exact commands, inputs, or screenshots
- **Impact** — what an attacker can do; severity if you've assessed
  (low / medium / high / critical, or a CVSS string)
- **Proof of concept** if you have one — minimal is better than
  comprehensive
- **Suggested fix** if you've thought of one (optional)

## What to expect

Honestly: **no guaranteed response time, no SLA.** Recall is maintained
in spare time by a single person — the same expectation as in the
[Code of Conduct](CODE_OF_CONDUCT.md). For most reports a first reply
arrives within a week or two; an actual fix and release follows when
there's a window of focused time.

If your situation is genuinely time-critical — an active exploit, a
production deployment at risk — you can fork the code and patch it
yourself. The Apache-2.0 license exists for exactly this.

## Coordinated disclosure

Once a fix is ready:

1. The fix lands on `main` with a description that doesn't yet name
   the vulnerability in detail.
2. A patched release is cut.
3. The security advisory is published, naming the reporter (with
   their permission) and describing the issue.

If you'd prefer to remain anonymous, say so in the advisory — that
preference is honored.

## Scope

In scope:

- The Recall codebase (`pkg/`, `frontend/`, `scripts/`, all
  `.github/workflows/` files, the published binaries and container
  images).
- The OpenAPI surface (`api/openapi.yaml`) and the HTTP server
  exposed by `pkg/cmd/server.go`.
- Default-on functionality (file watcher, OCR pipeline, SQLite
  persistence, Wails IPC).

Out of scope:

- Vulnerabilities in third-party dependencies — please file with the
  upstream project. We track CVEs via `make trivy` and `govulncheck`
  and bump on the next dep-update cycle (see `.github/dependabot.yml`).
- Optional integrations the user explicitly enables (the Prometheus
  endpoint at `:9091`, pprof under `RECALL_PPROF`). These are
  documented as "off by default — never expose publicly without your
  own access control."
- Misconfiguration on the user's host (e.g. exposing
  `RECALL_SERVER_ADDR=0.0.0.0:7000` on a public network without a
  reverse proxy).

## No telemetry

Recall ships with **no analytics, no crash reporters, no
phone-home, and no telemetry endpoint of any kind.** The app
runs entirely on-device:

- Match data lives in a local SQLite file under each profile's
  data directory (`~/Library/Application Support/Recall/` on
  macOS, `~/.config/recall/` on Linux, `%AppData%\Recall\` on
  Windows).
- The screenshots watcher reads the configured directory; it
  does not upload anywhere.
- The optional Prometheus endpoint (`localhost:9091/metrics`)
  is opt-in via Settings → Advanced and binds to loopback by
  default — no external scraper can reach it without an
  explicit reverse-proxy or `RECALL_PROMETHEUS_ADDR` override.
- The **Check for updates** button performs the only
  network call the app ever initiates on its own behalf: a
  single GET to `api.github.com/repos/sound-barrier/recall/
  releases/latest`. The button is user-triggered; mount-time
  network access was removed pre-1.0 specifically so a fresh
  launch makes zero outbound requests.

If you find code that breaks this property — anything that
sends user data off-device without an explicit opt-in — that
**is** a security bug. File it the same way as any other
vulnerability (Reporting a vulnerability above).

This is a deliberate design choice, not an accident of being
small. Adding telemetry would require an opt-in flag, a
visible privacy notice, and an off-by-default state — same as
the Prometheus endpoint already does.

## Past advisories

None at time of writing. Resolved advisories appear at
<https://github.com/sound-barrier/recall/security/advisories>.
