# Running Recall via Docker

> **Most advanced.** You only need this if you want to run Recall inside a
> container (e.g. alongside other containerized services on a NAS or home lab).
> For everyday use, the desktop app or the bare server binary is simpler — you
> don't need Docker just to use Recall. See [Running without the desktop app](server.md)
> for the lighter-weight headless option.

A pre-built Docker image with Tesseract included is pushed to GHCR on every
tagged release. The `:latest` tag tracks the most recent **stable** release;
prereleases (tags with a hyphenated suffix like `v0.1.0-beta.0`) publish only
their exact `:<version>` and never move `:latest`, so
`docker pull recall-server:latest` always lands on a non-prerelease build.

## Quick start

```sh
docker run \
  -e RECALL_SERVER_ADDR=0.0.0.0:7000 \
  -p 7000:7000 \
  ghcr.io/sound-barrier/recall-server:latest
```

Open `http://localhost:7000` in your browser once the container is running.

## Persistent setup (recommended)

The bare minimum above doesn't persist anything — matches and settings are lost
when the container stops. For real use, bind-mount your screenshots folder
(read-only is fine) and a named volume for the SQLite database and settings:

```sh
docker run \
  -e RECALL_SERVER_ADDR=0.0.0.0:7000 \
  -p 7000:7000 \
  -v ~/Documents/Overwatch/ScreenShots/Overwatch:/screenshots:ro \
  -v recall-data:/root/.config/recall \
  ghcr.io/sound-barrier/recall-server:latest
```

Then open the UI, go to **Settings → Directories → Change Folder…**, and point
it at `/screenshots`. The `recall-data` named volume keeps your parsed matches
and settings across container restarts.

## Image tags

| Tag | Meaning |
|---|---|
| `:latest` | Most recent stable release. Never moves on prereleases. |
| `:<major>.<minor>` (e.g. `:0.0`) | Rolling tag — updated on every stable patch in that minor line. |
| `:<version>` (e.g. `:0.0.15`) | Exact release. Never moves. |
| `:<version>-<suffix>` (e.g. `:0.0.15-beta.0`) | Prerelease — only the exact tag is published; `:latest` doesn't move. |

## Environment variables

| Variable | Default | Effect |
|---|---|---|
| `RECALL_SERVER_ADDR` | `127.0.0.1:7000` | Bind address. Set to `0.0.0.0:7000` inside a container so the port is reachable from the host. |
| `RECALL_PPROF` | *(off)* | When set to any non-empty value, mounts `net/http/pprof` handlers under `/debug/pprof/`. Never expose publicly. |
| `OWMETRICS_METRICS_ADDR` | `:9091` | Prometheus metrics endpoint address (when the Prometheus toggle is on). |
| `RECALL_DEBUG_DIR` | system temp | Directory for Tesseract work files. |

## Verifying the image

Every container pushed by the release workflow is signed with
[cosign](https://docs.sigstore.dev/cosign/signing/overview/) using
keyless OIDC — the workflow's own GitHub Actions identity is the
signing identity, so no long-lived signing keys exist anywhere.

To verify before pulling, install cosign
([install guide](https://docs.sigstore.dev/cosign/system_config/installation/))
then run:

```sh
cosign verify ghcr.io/sound-barrier/recall-server:latest \
  --certificate-identity-regexp 'https://github.com/sound-barrier/recall/\.github/workflows/release\.yml@refs/tags/v.*' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com'
```

A successful verify prints the signing certificate's claims (workflow
ref, commit SHA, etc.) and exits 0; tampering or a mismatched
identity exits non-zero. The same command works against any tag —
swap `:latest` for `:0.1.0`, `:0.1.0-beta.0`, etc.

This complements the SHA256 + build-provenance attestation chain
documented in the install guides: provenance proves "built by this
workflow," cosign proves "the image bits weren't tampered with after
upload."
