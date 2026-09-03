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

Paid alternatives, if the OSS application is declined:

- **Azure Trusted Signing** — around $10/month, runs headless in CI, no
  hardware token. Confirm current eligibility; Microsoft has been widening it
  beyond established businesses.
- **An EV certificate** — $300–500/year on a hardware token or cloud HSM. Buys
  immediate SmartScreen reputation, which an OV certificate has to earn over
  time.

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
