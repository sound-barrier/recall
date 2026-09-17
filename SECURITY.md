# Security Policy

## Supported versions

Recall is a small open-source Windows desktop app; only the **latest
tagged release** receives security updates. Older versions are not
patched — upgrade to the latest from
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

If your situation is genuinely time-critical, such as an exploit
already in use, you can fork the code and patch it yourself. The
Apache-2.0 license exists for exactly this.

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

- The Recall codebase (`pkg/`, `cmd/`, `frontend/`, `scripts/`, all
  `.github/workflows/` files) and the assets published on GitHub
  Releases: the installer, the updater exe, their signatures and
  checksums, and the build attestations.
- The in-app updater and the release pipeline that signs what it
  installs (see the update trust model below).
- The local HTTP API (`api/openapi.yaml`) that `recall.exe --server`
  serves from `pkg/cmd/server.go`, on `127.0.0.1:7000` by default.
- Default-on functionality (folder watcher, OCR pipeline, SQLite
  persistence, the Wails bridge between the window and the app).

Out of scope:

- Vulnerabilities in third-party dependencies — please file with the
  upstream project. We track CVEs with `task trivy`, `govulncheck` and
  Dependabot, and bump on the next dependency update (see
  `.github/dependabot.yml`).
- The pprof profiling endpoints you turn on with `RECALL_PPROF`. They
  are off by default and meant for local debugging only.
- Setting `RECALL_SERVER_ADDR` to anything but a loopback address. The
  `--server` mode has no authentication and is meant for the computer
  it runs on.

## Update integrity and trust model

Recall can replace itself with a newer release, which makes the updater
the one path by which a compromise of the project's GitHub releases
could run code on your computer. This section states what the updater
trusts, what it checks, and what it cannot stop.

### What Recall trusts

- **The Recall release key.** An Ed25519 public key is compiled into
  every Recall build from `pkg/updatesig/public_key.pem`. The SHA-256 of
  its DER encoding is
  `f0a7689b393a24397d4a230e09e53101cdfe401ade3793ab658ebfa9efbf6761`.
  The private half exists in two places only: a secret of the `release`
  environment, which a workflow job can read only after the maintainer
  approves it, and an escrow copy the maintainer keeps outside GitHub.
- **GitHub, for delivery only.** Release metadata, `SHA256SUMS`, the
  exe and its signature all come from GitHub over HTTPS, with no
  certificate pinning. The signature, not the connection, is what
  proves an update is genuine.

### What the updater checks

An update runs only when you choose **Install update** in **About
Recall**; Recall never checks for or installs a release in the
background. It installs a release only if every one of these holds:

1. The release's `SHA256SUMS` lists a SHA-256 digest for its updater
   exe.
2. The exe is named `recall-<version>-windows-amd64.exe` for that same
   release's version.
3. `recall-<version>-windows-amd64.exe.sig`, fetched from `github.com`
   over HTTPS, is a 64-byte Ed25519 signature that the compiled-in key
   made over `recall-update-signature-v1`, a newline, the exe's name,
   a newline, and the 32 raw bytes of that SHA-256 digest.
4. The exe it downloads hashes to that same digest.

Every redirect along the way must stay on HTTPS and on GitHub's hosts
(`api.github.com`, `github.com`, `*.githubusercontent.com`, and
`sound-barrier.github.io` for game data), and a fetch stops after 10
redirects. A signature GitHub reports missing (HTTP 404) is a refusal;
any other failure to fetch one is an error you can retry.

A release that fails check 1, 2 or 3 is refused, and the About dialog
shows **Update not installed**. Don't install that release by hand: wait
for the next release, or check the
[Security advisories](https://github.com/sound-barrier/recall/security/advisories)
page. A download that fails check 4 is an error rather than a refusal:
About shows the error with **Try again**, and nothing is installed. If
the compiled-in key cannot be read, self-update turns off and About
offers only **Open release page**.

Recall deliberately leaves the signature check built into its update
framework (Wails) unused. That check covers the digest alone, so it
would accept an older signed exe republished under a newer version.

### What this defends against

- A release published or edited without the release key, whether by a
  leaked workflow token, a job with write access to releases, or by
  hand. Its exe carries no valid signature, so Recall refuses it.
- A partial release. A missing `SHA256SUMS` entry or `.sig` file is a
  refusal, not a skipped check.
- A downgrade. An older signed exe republished under a newer tag fails
  the name check.
- A download tampered with in transit, on a mirror, or through a
  redirect.

### What it does not defend against

- **The maintainer's GitHub account, or any token with its rights**,
  such as a signed-in GitHub CLI. That account approves the signing
  job, so whoever controls it can get a malicious release signed.
- **Anyone who can push a `v*` tag.** A tag runs the release workflow
  as it exists at the tagged commit, so a tag on a commit that edits
  the workflow skips its checks and can publish a release, with a
  build attestation, under the workflow's name. It cannot sign that
  release without the approval above, so a Recall that checks
  signatures refuses it. Copies older than the first signed release do
  not check, and neither does anyone who installs it by hand without
  checking the signature.
- **Theft of the release key.** Whoever holds the private key can sign
  anything. [RELEASES.md](RELEASES.md) covers its custody and rotation.
- **Withheld updates.** Nothing here stops someone from deleting
  releases or blocking your connection to GitHub, which leaves you on
  the version you have.

### Releases before signing

Copies of Recall older than the first release published with `.sig`
files check only the digest in `SHA256SUMS`, which comes from the same
release as the exe, and install without any check when that file is
missing. The update *to* the first signed release gets only that
check; every update after it gets the signature check.

### Verifying a download yourself

[Verifying your download](docs/install-windows.md#verifying-your-download)
covers three checks: the `.sha256` checksum, the signature with
OpenSSL, and `gh attestation verify` pinned to the release workflow and
tag. A checksum match proves only that the file is intact. An
attestation shows which workflow file and tag built a file, but a tag
on an edited workflow attests too. The signature is the check that
needs the release key.

## No telemetry

Recall ships with **no analytics, no crash reporters, no
phone-home, and no telemetry endpoint of any kind.** The app
runs entirely on-device:

- Match data lives in a local SQLite database under each profile's
  folder in `%AppData%\Recall\`.
- The folder watcher reads the folder you choose; it does not upload
  anywhere.
- A fresh launch makes zero outbound requests. Recall checks for
  updates only when you open **About Recall**, and downloads an update
  only when you choose to install it.
  [docs/privacy.md](docs/privacy.md) lists every host those requests
  reach.

If you find code that breaks this property — anything that
sends user data off-device without an explicit opt-in — that
**is** a security bug. File it the same way as any other
vulnerability (Reporting a vulnerability above).

This is a deliberate design choice, not an accident of being
small. Adding telemetry would require an opt-in flag, a
visible privacy notice, and an off-by-default state.

## Past advisories

None at time of writing. Resolved advisories appear at
<https://github.com/sound-barrier/recall/security/advisories>.
