# Code signing policy

This is Recall's public code signing policy. It states who may authorize a
signature, what may be signed, and what must be true before a signature is
requested. It exists so that anyone — a user, a certificate authority, or
SignPath Foundation — can check the process rather than take it on trust.

**Last updated: 2026-09-06**

## What gets signed

Exactly two artifacts, both produced by
[`.github/workflows/release.yml`](https://github.com/sound-barrier/recall/blob/main/.github/workflows/release.yml)
from a tagged commit:

| Artifact | What it is |
|---|---|
| `recall-<version>-windows-amd64.exe` | the application executable; also the file the in-app updater installs |
| `recall-<version>-windows-amd64-installer.exe` | the NSIS installer people download |

Nothing else is signed. No test build, no local build, no branch build, and no
artifact built anywhere but that workflow is ever submitted for signature.

The executable is signed **before** the installer is built around it, so the
file that lands on disk after installation carries a signature too — not only
the installer that placed it.

## Roles

Recall is maintained by one person. This section says so plainly rather than
inventing a committee, and describes what actually performs each function.

| Role | Who |
|---|---|
| **Author** | Jacob Delgado, the sole human author. Automated dependency updates are authored by Dependabot. |
| **Reviewer** | No second human reviewer exists. Review is performed mechanically — see below. |
| **Approver** | Jacob Delgado, and only via the manual step described under *Releasing*. |

**What stands in for a second reviewer.** Changes reach `main` through pull
requests, and `main` carries **17 required status checks** with branch
protection set to require branches be up to date first. Those checks include
CodeQL, Trivy, `govulncheck`, Semgrep, GitHub dependency review, unit and
end-to-end test suites, and enforced coverage floors. Every external GitHub
Action is pinned by full commit SHA (currently 81 of 81), so a compromised
upstream tag cannot silently change what runs. Force pushes and branch deletion
are blocked.

Two limits on that, stated because a policy that overstates its own controls is
worth less than one that admits them:

- **Pull requests are a project convention, not a mechanical requirement.**
  `required_pull_request_reviews` is not configured, and `enforce_admins` is
  off, so the maintainer can push to `main` as repository administrator. The
  convention is written down in `CONTRIBUTING.md` and followed; it is not
  enforced against the maintainer by GitHub.
- **One direct push is intentional.** A `Release-As:` prep commit may go
  straight to `main` to retarget the release-please pull request. It changes no
  shipped code and publishes nothing.

This is weaker than independent human review and is not presented as
equivalent. It is stated here so the gap is visible rather than implied.

## What must be true before a signing request

A signature is requested only for a build where all of the following hold:

1. The build ran in GitHub Actions from a tag on `main`, in a workflow whose
   definition is public and version-controlled.
2. Every required status check passed on the commit being released.
3. The build is reproducible from public source: pure Go, `CGO_ENABLED=0`, no
   vendored binaries, and no build step that fetches unpinned code.
4. The artifacts carry a [SLSA build provenance
   attestation](https://github.com/sound-barrier/recall/attestations), verifiable
   by anyone with
   `gh attestation verify <file> --repo sound-barrier/recall`.
5. An SBOM and a `SHA256SUMS` file are published alongside them.

If a signing service returns an artifact that is not actually signed, the
release fails rather than publishing it. This is enforced in code
(`scripts/release/install-signed-artifact.sh`): an Authenticode signature is
appended to a PE file, so a signed artifact is strictly larger than its input,
and an equal-sized result means the request matched nothing.

## Releasing

Releases are never automatic. Publishing requires a human action taken
deliberately: the maintainer merges the release pull request or pushes the tag.
No bot, schedule, or merge to `main` can trigger a signed release on its own,
and the project's own contributor rules state this as a standing constraint.

Every signing request is therefore approved individually, by a person, for a
specific version.

## Credentials

- Signing credentials live only in GitHub Actions repository secrets, scoped to
  this repository.
- They are never present in a pull-request build. Workflows triggered by
  `pull_request` cannot read them, and the signing steps run only in the
  tag-triggered release workflow.
- Multi-factor authentication is required on the maintainer's GitHub account.
- Credentials appear in no local development flow. Building locally produces
  unsigned binaries, by design.
- If credentials are believed to be exposed, they will be revoked before any
  further release, and the incident recorded in the repository's security
  advisories.

## If a signed release turns out to be harmful

Report it privately through
[the security policy](https://github.com/sound-barrier/recall/security/advisories/new)
rather than a public issue. A signed build found to be compromised will have its
release withdrawn, its certificate revocation requested, and an advisory
published naming the affected versions.

## Verifying a signature yourself

On Windows:

```powershell
Get-AuthenticodeSignature .\recall-<version>-windows-amd64-installer.exe
```

`Status` must read `Valid`. On any platform, `osslsigncode verify <file>` reports
the same thing, and `gh attestation verify <file> --repo sound-barrier/recall`
independently confirms the file came from this repository's release workflow.

## Related

- [Privacy](privacy.html) — what Recall does and does not send anywhere
- [Security policy](https://github.com/sound-barrier/recall/blob/main/SECURITY.md)
- [Contributing](https://github.com/sound-barrier/recall/blob/main/CONTRIBUTING.md)
