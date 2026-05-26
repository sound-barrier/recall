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

Wrapping the `MatchResult` in a two-field snapshot means a parser
change that breaks classification (e.g. SUMMARY stops populating
`Date`, which `ScreenshotType` keys off → suddenly classifies as
`scoreboard`) trips the test even when the underlying `MatchResult`
fields look reasonable.

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

- [x] post-match SUMMARY tab (×2 — Antarctic Peninsula / Juno + New Queen Street / Lucio)
- [x] post-match TEAMS scoreboard
- [x] post-match PERSONAL tab — single hero (Juno, hero stats subfield)
- [x] post-match PERSONAL tab — second hero in a multi-hero match (Mei from same match)
- [ ] rank screen — competitive ladder badge + per-hero SR card
- [ ] in-game TAB scoreboard (different layout, right panel populated)
- [ ] match where the player swapped heroes, captured from the SUMMARY
      side (exercises `parseHeroesPlayed` ordering — the current
      committed SUMMARY only lists the primary hero because of a
      known OCR weakness on the second-hero row; revisit if that
      parser path is tightened)

## Privacy / licensing

The committed PNG files are deliberately curated post-match captures.

If you're considering adding a new fixture and you're not the
maintainer, open an issue first describing the source. The parser
extracts no BattleTags itself — so the golden JSON sidecars are
inherently identity-free — but the PNG bytes are user-visible
content and warrant a sanity check.

## Tesseract version

Goldens are baselined against whichever Tesseract is on the
maintainer's dev machine at update time. If CI runs a different
version and OCR drift trips a single-character mismatch on a
borderline field, regenerate the sidecars (`make update-goldens
RECALL_FIXTURE_DIR="$PWD/testdata"`) and commit the diff — that's
the documented response, not a bug. A future tightening pass could
pin Tesseract in CI via `tool-versions.env`; for now the maintainer
just keeps the dev/CI versions roughly in sync.
