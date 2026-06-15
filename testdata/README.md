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

## Coverage targets

Filled when fixtures land. Unchecked = slot still wanted, the
maintainer drops in a PNG later via `make update-goldens` and commits.

- [x] post-match SUMMARY tab (×3 — Antarctic Peninsula / Juno + New Queen Street / Lucio + Rialto / Wuyang·Juno·Kiriko 3-hero swap)
- [x] post-match TEAMS screen — role queue (5v5) AND open queue (6v6, Hollywood); the pair pins `queue_type` detection from the players-per-team count
- [x] post-match PERSONAL tab — single hero (Juno, hero stats subfield)
- [x] post-match PERSONAL tab — second hero in a multi-hero match (Mei from same match)
- [x] post-match PERSONAL tab — Wuyang; pins the AVG-anchored stat fix (Players Saved 5, Tidal Blast Kills 0 — the hero-ability icon OCRs as a spurious leading/trailing single digit)
- [x] PERSONAL "All Heroes" aggregate view — recognized as `all_heroes` but deliberately NOT parsed (its totals duplicate the TEAMS screen; its stat-card icons defeat the OCR). The golden pins detection + the recognized-skip classification that keeps it off the Unknown tab without a garbage row.
- [x] rank screen — competitive ladder badge + per-hero SR card (×2: a Platinum 5 **win** with positive progress + SR gain, AND a Gold 1 **loss** with DEMOTION PROTECTION and a negative −19% progress; the pair pins the digitize-level fix, the raw-pass negative-progress read, the lower-card SR crop, and the demotion-protection modifier)
- [ ] in-game TAB screenshot (different layout, right panel populated)
- [x] match where the player swapped heroes, captured from the SUMMARY
      side — the Rialto capture lists all three heroes (Wuyang 47% ·
      Juno 46% · Kiriko 7%), exercising `parseHeroesPlayed` ordering with
      no second-hero drop.

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
