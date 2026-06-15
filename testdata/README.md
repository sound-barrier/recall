# Parser golden-file fixtures

Real Overwatch screenshots + sidecar `.golden.json` files that
`TestParseScreenshot_GoldenFiles` in
[`pkg/parser/integration_test.go`](../pkg/parser/integration_test.go) runs
against to catch OCR / parser regressions.

## How it works

For each `foo.png` in this directory, the test:

1. Runs `ParseScreenshot("foo.png")`.
2. Computes the screenshot classification via `parser.ScreenshotType(result)`.
3. Reads `foo.png.golden.json` from the same directory.
4. Fails if either the classification OR the parsed `MatchResult`
   doesn't match.

Each golden has shape:

```json
{
  "screenshot_type": "summary",
  "result": { "map": "rialto", "mode": "competitive", "...": "..." }
}
```

The `result` is the **per-screenshot-type projection** of
`MatchResult` (see `pkg/parser/golden.go`): a SUMMARY golden has
no `damage` / `healing` / `mitigation` (SUMMARY doesn't extract
them); a PERSONAL golden has no `map` / `type` / `E/A/D`; a
TEAMS has no `result` / `date` / `game_length`; a RANK has
no `map` / combat stats; an `all_heroes` golden carries only the
recognition marker (`all_heroes: true`), since the PERSONAL "All
Heroes" aggregate is detected but its stats are deliberately not
parsed. Showing only the fields a screenshot type
*can* populate keeps `0` / `""` from looking like "the parser saw
0 deaths" when it actually means "this screen has no deaths to
parse".

Wrapping the result in a two-field snapshot means a parser change
that breaks classification (e.g. SUMMARY stops populating `Date`,
which `ScreenshotType` keys off → suddenly classifies as
`teams`) trips the test even when the underlying fields look
reasonable.

**Maintenance:** when a `parse_<type>.go` starts populating a new
`MatchResult` field, add it to the matching `*Golden` struct in
`pkg/parser/golden.go`, run `make update-goldens`, and commit the
diff. If you forget, the new field is silently dropped from the
golden — the test still passes, but the regression coverage on
that field is invisible.

`go test ./pkg/parser/` picks the directory up automatically (the test
defaults to `../../testdata` relative to its package dir, which
resolves to this dir). The test skips cleanly if the directory has no
PNG files or Tesseract isn't installed.

## Adding a fixture

1. Drop the PNG here.
2. From the repo root: `make update-goldens RECALL_FIXTURE_DIR="$PWD/testdata"`
   (an explicit absolute path is required because the test binary's
   cwd is `pkg/parser/`; `RECALL_FIXTURE_DIR=testdata` would resolve
   relative to that and miss this dir).
3. **Eyeball the JSON** before committing — confirm the fields
   match what the screenshot shows.
4. Commit both the PNG and its `.golden.json`.

## Finding bugs in your own captures

To check whether the parser reads *your* screenshots correctly — without
copying anything into this directory first — point `gen-goldens` at a file
or a folder and eyeball the JSON it writes next to each image:

```sh
make goldens SRC=path/to/screenshot.png   # one file
make goldens SRC=path/to/folder           # every image in a folder
scripts/gen-goldens.sh path/to/folder     # same, without make
```

Compare each `*.golden.json` against what the screenshot shows; anything
wrong or missing is a parser bug worth reporting. It's the same machinery
`make update-goldens` uses, so a capture that reads cleanly is ready to be
dropped in here as a fixture.

## Coverage targets

Filled when fixtures land. Unchecked = slot still wanted, the
maintainer drops in a PNG later via `make update-goldens` and commits.

- [x] post-match SUMMARY tab (×4 — Antarctic Peninsula / Juno + New Queen Street / Lucio + Rialto / Wuyang·Juno·Kiriko 3-hero swap + Hollywood / Baptiste·Junkrat·Reinhardt tri-role swap, the last pinning the bracket-mangled eliminations fix: the performance card OCRs "11" as "1]", recovered to the true 11)
- [x] post-match TEAMS screen — role queue (5v5) AND open queue (6v6, Hollywood); the pair pins `queue_type` detection from the players-per-team count
- [x] post-match PERSONAL tab — single hero (Juno, hero stats subfield)
- [x] post-match PERSONAL tab — second hero in a multi-hero match (Mei from same match)
- [x] post-match PERSONAL tab — Wuyang; pins the AVG-anchored stat fix (Players Saved 5, Tidal Blast Kills 0 — the hero-ability icon OCRs as a spurious leading/trailing single digit)
- [x] PERSONAL "All Heroes" aggregate view — recognized as `all_heroes` but deliberately NOT parsed (its totals duplicate the TEAMS screen; its stat-card icons defeat the OCR). The golden pins detection + the recognized-skip classification that keeps it off the Unknown tab without a garbage row.
- [x] rank screen — competitive ladder badge + per-hero SR card (×2: a Platinum 5 **win** with positive progress + SR gain, AND a Gold 1 **loss** with DEMOTION PROTECTION and a negative −19% progress; the pair pins the digitize-level fix, the raw-pass negative-progress read, the lower-card SR crop, and the demotion-protection modifier)
- [ ] in-game TAB screenshot (different layout, right panel populated)
- [x] non-match screen → `unknown` — the career **HISTORY / Game Reports**
      browser (a list of past matches). Guards that the classifier leaves
      non-match screens on the Unknown tab rather than mis-parsing the list.
- [x] cross-capture-tool robustness — the same Ilios/Lucio match via Windows
      PrintScreen (low-quality JPG). TEAMS reads cleanly (9/10/5), but the
      SUMMARY performance card **over-reads eliminations as 74** on the noisy
      JPG — capture quality matters (PNG / NVIDIA / Steam parse cleanly; heavy
      JPG compression confuses the perf-card OCR). See `parser.md`.
- [x] **1080p downscale robustness** — the rank win + loss fixtures resized
      2560×1440 → 1920×1080 `(1080p)`. The parser's relative crops read the
      same data at 1080p, including the thin colored "+25%" rank-gain pill: the
      inverted/raw passes lose it at 1080p, but a thresholded (bright→black)
      high-contrast fallback recovers it. SUMMARY / TEAMS / PERSONAL are
      resolution-robust unchanged. Scope is 1080p + 1440p; 4K and sub-1080p are
      out of scope.
- [x] match where the player swapped heroes, captured from the SUMMARY
      side — the Rialto capture lists all three heroes (Wuyang 47% ·
      Juno 46% · Kiriko 7%), exercising `parseHeroesPlayed` ordering with
      no second-hero drop.
- [x] **complete match, end to end** — the Hollywood open-queue (6v6)
      competitive victory captured across all six screenshots
      (00.28.29–39): SUMMARY + post-match TEAMS + three PERSONAL tabs
      (the baptiste→junkrat→reinhardt tri-role swap) + the All Heroes
      aggregate. The corpus's full-correlation case:
      `TestApp_ParseScreenshots_CompleteOpenQueueMatchFolds` folds the six
      into one match (2-min window + the now-matching 11/12/3 EAD
      signature), exercising the off-hero PERSONAL bridge and the All
      Heroes skip. Also the cross-check that surfaced the eliminations
      bug — SUMMARY and TEAMS E/A/D must agree, and didn't (4 vs 11) until
      the bracket-mangled-digit fix. The three PERSONAL goldens also pin
      hero-ability-cell recovery: small (0/1) values next to the card icon
      OCR their lone digit as a letter ("1"→"T", "0"→"O"), so the value scan
      finds nothing — `parsePersonalStatCell` now recovers it from the clean
      AVG line (value = avg × play/10) instead of dropping the cell (Charge
      Kill, Rip-Tire Kill, Immortality Field Death Prevented, Fire Strike
      Kills). A couple of long labels still OCR imperfectly (`RIP-TIRE KILL`
      → `tire_kill`, `EARTHSHATTER KILLS` → `earthshatiter_kills`) — values
      correct, label-snapping is a follow-up.

## Privacy / licensing

The committed PNG files are deliberately curated post-match captures.

If you're considering adding a new fixture and you're not the
maintainer, open an issue first describing the source. The parser
extracts no BattleTags itself — so the golden JSON sidecars are
inherently identity-free — but the PNG bytes are user-visible
content and warrant a sanity check.

## Tesseract version

Goldens are baselined against the Tesseract version pinned in
`tool-versions.env` (`TESSERACT_VERSION`, major.minor). CI's
schemathesis job and `.devcontainer/postCreate.sh` both install
whatever apt has and assert the installed major.minor matches the
pin — a mismatch hard-fails CI with an explicit "re-baseline and
bump" message.

When that fires (Ubuntu base image rolls forward, Homebrew bumps,
etc.): re-baseline locally with `make update-goldens
RECALL_FIXTURE_DIR="$PWD/testdata"`, bump `TESSERACT_VERSION` to the
new major.minor, and commit both changes together.
