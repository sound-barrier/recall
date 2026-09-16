# Code signing (maintainer)

Recall's Windows artifacts ship **unsigned** until the setup below is done.
This page is the setup, and the reason it matters.

## Why

Windows Defender flagged a Recall release as malware. It was a false positive,
and it was predictable — the build hits nearly every heuristic at once:

| What Recall does | How a scanner reads it |
|---|---|
| No Authenticode signature, new file hash, few installs | unknown publisher, zero reputation |
| Statically-linked Go binary | Go is the modern malware language; the heuristics are tuned against it |
| NSIS installer | the format adware bundlers live in |
| Watches a folder for new images | screenshot harvesting |
| Spawns a child with `CREATE_NO_WINDOW` (`pkg/app/tesseract.go`) | console-hiding — an evasion heuristic |
| Downloads an `.exe` and swaps the running binary (`pkg/cmd/selfupdate.go`) | dropper |
| Installer runs `taskkill /F /T /IM` (`project.nsi`) | killing a process to replace it |

Every row is doing real work. Together they describe an infostealer. The one
lever that actually moves is the first row, and it is the only one worth
pulling — contorting the others would trade real behavior for a heuristic's
opinion.

**Build provenance is not a substitute.** `release.yml` attests every artifact
with `actions/attest-build-provenance` and publishes `SHA256SUMS`. Both are
real, and both are invisible to Windows: attestation proves origin to someone
running `gh attestation verify`, not to the OS trust layer. Only Authenticode
reaches Defender and SmartScreen.

## Getting a certificate

**SignPath Foundation** issues free code-signing certificates to open-source
projects, which is what `release.yml` is wired for. Apply at
<https://signpath.org/apply>. Expect the review to take days, not minutes, and
to be asked about exactly the behaviors in the table above — the self-updater
and the hidden subprocess are the two worth explaining up front.

Point the reviewer at the published privacy policy —
<https://sound-barrier.github.io/recall/privacy.html> — which answers those
questions in writing: nothing is collected or uploaded, the app is receive-only,
and it closes with a table explaining each behavior a scanner flags. Source:
`docs/privacy.md`.

Paid alternatives, if the OSS application is declined:

- **Azure Trusted Signing** — around $10/month, runs headless in CI, no
  hardware token. Confirm current eligibility; Microsoft has been widening it
  beyond established businesses.
- **An EV certificate** — $300–500/year on a hardware token or cloud HSM. Buys
  immediate SmartScreen reputation, which an OV certificate has to earn over
  time.

## The application

SignPath Foundation accepts at their discretion and states plainly that projects
have no right to a certificate. The binding criterion for a project this young
is reputation — they say they "cannot sign binaries based on source code that
nobody knows." Recall is weak there and strong nearly everywhere else, so the
application should lead with what is verifiable and concede the rest rather than
pad it.

Where Recall stood on 2026-09-06: 59 releases since 2026-05-25, 2,174 commits in
111 days, 116 installer downloads, and **zero stars, forks, watchers, or
externally-filed issues**. Do not dress that up. A reviewer will look.

Draft:

> **Project:** Recall — <https://github.com/sound-barrier/recall>
> **License:** Apache-2.0, no dual licensing, no proprietary components.
> **Docs:** <https://sound-barrier.github.io/recall/>
> **Code signing policy:** <https://sound-barrier.github.io/recall/code-signing-policy.html>
> **Privacy policy:** <https://sound-barrier.github.io/recall/privacy.html>
>
> Recall is a Windows desktop app that reads a player's own Overwatch
> post-match screenshots with local OCR and turns them into a searchable match
> history. It runs entirely offline. It has no account, no server, no
> telemetry, and no upload path of any kind — the privacy policy above states
> this and the source backs it.
>
> **On reputation, plainly:** the project is four months old and has no stars
> and no external contributors. 59 releases have been published and the
> installer has been downloaded 116 times. I am not going to claim a user base
> I do not have. What I offer instead is that every claim here is mechanically
> checkable:
>
> - Every artifact carries a SLSA build provenance attestation. Any release can
>   be verified with
>   `gh attestation verify <file> --repo sound-barrier/recall`, tying the binary
>   to the workflow, commit and tag that produced it.
> - Builds are pure Go, `CGO_ENABLED=0`, from public source, in a public
>   workflow, with no vendored binaries and no unpinned fetch. All 81 external
>   GitHub Actions are pinned by full commit SHA.
> - `main` carries 17 required status checks including CodeQL, Trivy,
>   govulncheck, Semgrep and dependency review, plus enforced test-coverage
>   floors. An SBOM and SHA256SUMS ship with every release.
> - Releases are never automatic; each one is triggered deliberately by me.
>
> **Disclosure — a Defender false positive.** Windows Defender flagged a recent
> unsigned release as malware. I am raising it before you find it. The build
> hits several heuristics at once: an unsigned, statically-linked Go binary
> with no download reputation, in an unsigned NSIS installer, that watches a
> user-chosen folder for images, launches Tesseract as a hidden child process
> to avoid a console flash over the game, replaces its own executable when the
> user accepts an update, and whose installer closes a running instance before
> upgrading. Each is documented in the privacy policy with the reason it
> exists. None sends data anywhere — there is no POST, PUT or multipart code
> path in the repository. A signature is precisely what this build lacks, which
> is why I am applying.
>
> **Roles.** I am the sole maintainer and am named as Author and Approver. There
> is no second human reviewer; the code signing policy says so explicitly and
> describes the automated gates that stand in for one. MFA is enabled.

One thing to confirm before sending, because the policy asserts it: **MFA is on**
for the GitHub account.

The branch-protection gap an earlier draft had to concede is closed. `main` now
requires a pull request with "do not allow bypassing" enabled, so direct pushes
are rejected for the maintainer too. The required approval count is deliberately
zero: GitHub forbids self-approval, so on a one-person project any higher number
would prevent merging rather than add review. Say that in those terms if asked --
it reads as a considered decision, which it is, rather than a control switched
off for convenience.

## SignPath configuration

Create a project (suggested slug `recall`) with a signing policy
(`release-signing`) and **two artifact configurations**, because two different
shapes get signed:

| Artifact configuration | Shape uploaded | Signs |
|---|---|---|
| `exe` | a zip containing `Recall.exe` | the PE file inside |
| `installer` | a zip containing `recall-amd64-installer.exe` | the PE file inside |

Both are zips because that is how GitHub hands artifacts to SignPath — declare
a zip wrapping a single PE file in each configuration, not a bare PE.

## Repository configuration

One secret:

| Secret | Value |
|---|---|
| `SIGNPATH_API_TOKEN` | SignPath CI user token |

Four variables (Settings → Secrets and variables → Actions → Variables):

| Variable | Value |
|---|---|
| `SIGNPATH_ORGANIZATION_ID` | the GUID from SignPath |
| `SIGNPATH_PROJECT_SLUG` | `recall` |
| `SIGNPATH_SIGNING_POLICY_SLUG` | `release-signing` |
| `SIGNPATH_EXE_ARTIFACT_CONFIG` | `exe` |
| `SIGNPATH_INSTALLER_ARTIFACT_CONFIG` | `installer` |

With `SIGNPATH_API_TOKEN` unset the release still builds and publishes — it
just prints a `::warning::` saying the artifacts are unsigned. That is
deliberate: the OSS application takes days, and a hard failure would mean no
releases until it clears. It is never silent.

## The order signing happens in, and why

The NSIS installer **embeds** `recall.exe`. So the exe is signed before the
installer is built:

```text
build-windows-exe  ->  sign exe  ->  build-windows-installer  ->  sign installer
```

Sign only the finished artifacts and the file that lands in
`%LOCALAPPDATA%\Programs\Recall` is unsigned — flagged at runtime no matter how
well-signed the installer was. That is the failure this ordering exists to
prevent, and it is why `task build-windows` is split into halves.

`build-windows-installer` calls `makensis` directly rather than
`wails3 task windows:create:nsis:installer`, because that upstream task
declares `deps: [build]` with no up-to-date guard and would rebuild the exe,
discarding the signature. Keep the invocation in step when the wails trio is
bumped; CI's `build-windows` job runs it on every PR.

Hashing and attestation both run **after** signing, so `SHA256SUMS` and the
provenance cover the bytes people actually download.

## Verifying a signed release

On Windows:

```powershell
Get-AuthenticodeSignature .\recall-X.Y.Z-windows-amd64-installer.exe
```

`Status` must be `Valid` and `SignerCertificate` must name the expected
publisher. On any platform, `osslsigncode verify <file>` does the same job.

`install-signed-artifact.sh` also checks the cheap invariant in CI: an
Authenticode signature is appended to a PE, so a signed file is strictly
larger than its input. Equal size means SignPath returned the input untouched,
and the release fails rather than shipping an unsigned binary labeled signed.

## Reporting the current false positive

Signing fixes future releases. Releases already published stay flagged until
Microsoft reclassifies them, which is free and usually takes a day or two.

Submit at <https://www.microsoft.com/en-us/wdsi/filesubmission> as a **software
developer**, one submission per flagged file. Draft:

> **Product:** Recall — <https://github.com/sound-barrier/recall>
>
> **Detection:** [paste the exact name Defender reported, e.g.
> `Trojan:Win32/Wacatac.B!ml`]
>
> **This is a false positive.** Recall is an open-source Overwatch match
> tracker. It is built in public by GitHub Actions from the tagged commit; the
> workflow is `.github/workflows/release.yml` and every artifact carries a
> SLSA build-provenance attestation verifiable with
> `gh attestation verify <file> --repo sound-barrier/recall`.
>
> The behaviors most likely to have triggered the ML classifier, all
> documented and all in public source:
>
> - It watches a user-selected folder for new screenshots and reads them.
>   This is the app's entire purpose; the folder is chosen by the user.
> - It runs Tesseract OCR as a child process with `CREATE_NO_WINDOW`, purely
>   to suppress a console flash on a desktop app.
> - It has an opt-in self-updater that downloads a signed release asset from
>   this repository's GitHub Releases and replaces its own executable.
> - The NSIS installer calls `taskkill` on a running instance before
>   upgrading, because the running exe holds a lock on itself.
>
> It collects no credentials, contacts no server other than github.com and
> the project's own GitHub Pages, and transmits no user data.

Once signing is live, update `docs/install-windows.md` §3 — it currently walks
users through the SmartScreen approval dance, which a signed build shortens.
