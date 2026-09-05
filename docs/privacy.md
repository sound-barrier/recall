# Privacy

**Last updated: 2026-09-05**

Recall does not collect your data. There is no account, no server, no
telemetry, and nothing to opt out of.

Everything Recall knows about you — your screenshots, the text read out of
them, your match history, your notes and reviews — is created on your computer
and stays there. Recall has no way to send it anywhere, because no code in it
uploads anything.

## What stays on your machine

All of it:

- **Screenshots** you point Recall at. It reads them where they already are.
- **Text read from them by OCR.** Tesseract runs as a program on your computer.
  Images are never sent anywhere to be read.
- **Your match history** — the SQLite database Recall builds from those
  screenshots.
- **Notes, reviews, focus items, and coaching sessions** you write.
- **Settings**, including which folder to watch.
- **Log files**, written next to your data for troubleshooting.

Where these live on disk is documented in
[How it works → Where things live on disk](how-it-works.html#where-things-live-on-disk).
They are ordinary files. You can read, back up, or delete them without Recall's
help, and uninstalling leaves them for you to remove.

## What leaves your machine

Only update checks, and only when you ask for one.

When you press **Check for updates**, Recall makes plain HTTP GET requests to:

| Host | For |
|---|---|
| `api.github.com`, `github.com` | whether a newer release exists |
| `objects.githubusercontent.com` | the release file itself, if you install it |
| `sound-barrier.github.io` | the hero, map and season reference lists |

These requests are **downloads**. They carry no request body, no query
parameters about you, and no custom headers — nothing is attached that
identifies you or your machine.

**They are not invisible, and it would be dishonest to say otherwise.** Any
HTTP request tells the server it came from your IP address at a particular
time. So GitHub can see that some computer at your IP asked whether a Recall
release exists. That is the entire extent of it, it is the unavoidable cost of
downloading a file from anywhere, and it is governed by
[GitHub's privacy statement](https://docs.github.com/site-policy/privacy-policies/github-privacy-statement).

Recall never checks on its own. After 90 days it will show a banner suggesting
you check — the banner is drawn from a date stored on your machine, not from
asking anyone anything.

## What Recall does not do

- No analytics, telemetry, or usage statistics.
- No crash or error reporting.
- No accounts, logins, or license checks.
- No advertising, tracking, or third-party SDKs of any kind.
- **No uploads.** There is no code path in Recall that sends a file, an image,
  or a database anywhere. It only ever downloads.

> Recall describes itself in its own window as "Personal Telemetry". That is a
> phrase about what the app is *for* — measuring your own play — not a
> description of data collection. Nothing is reported to anyone.

## Sharing, when you choose to

**Send to Coach** and the export tools write a **file** to a location you pick.
Recall does not transmit it. If you send that file to a coach, you send it the
way you would send any other file, and you decide what to include before you do.

Reviews and coaching sessions work the same way: they are files on your
computer, exchanged by you.

## Behavior that looks alarming, and why it isn't

Recall does a few things that resemble what unwanted software does. They are
listed here because a security scanner has flagged them, and because you
deserve to know what the app is doing rather than discover it.

| What it does | Why |
|---|---|
| Watches a folder for new image files | This is the whole product: it notices a new screenshot and reads it. The folder is one you choose, and watching can be turned off. |
| Runs a hidden child process | Recall calls Tesseract, the OCR program, once per screenshot. The window is hidden so a black console box does not flash over your game. Nothing else is run. |
| Replaces its own program file when updating | That is what installing an update means. It happens only when you accept an update. |
| The installer force-closes a running Recall | Windows will not let a program be overwritten while running. The installer closes it first, then upgrades. |

All of it is open source. If any claim on this page is wrong, the code that
proves it is at <https://github.com/sound-barrier/recall> — and a report of the
discrepancy is a bug we want.

## Children

Recall is a tool for Overwatch players. It collects nothing from anyone, of
any age.

## Changes

This page is versioned in the repository, so every change to it is visible in
the project's history. The date at the top is the last time it changed.

## Contact

Questions, or something here that does not match what you observe:
[open an issue](https://github.com/sound-barrier/recall/issues).
