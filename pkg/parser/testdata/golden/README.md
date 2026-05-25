# Parser golden-file fixtures

Real Overwatch screenshots + sidecar `.golden.json` files that
`TestParseScreenshot_GoldenFiles` in
[`integration_test.go`](../../integration_test.go) runs against to
catch OCR / parser regressions.

## How it works

For each `foo.png` in this directory, the test:

1. Runs `ParseScreenshot("foo.png")`.
2. Reads `foo.png.golden.json` from the same directory.
3. Fails if the parsed `MatchResult` doesn't match.

`go test ./pkg/parser/` picks the directory up automatically. The
test skips cleanly if the directory has no PNG files (current state) or
Tesseract isn't installed.

## Adding a fixture

1. Drop the PNG here.
2. From the repo root: `make update-goldens FIXTURE=foo.png`
   (or `make update-goldens` to regenerate every golden).
3. **Eyeball the JSON** before committing — confirm the fields
   match what the screenshot shows.
4. Commit both the PNG and its `.golden.json`.

## Coverage targets

A complete set is one fixture per detected screenshot type plus a
handful of edge cases:

- [ ] `rank.png` — rank screen
- [ ] `summary.png` — post-match SUMMARY tab
- [ ] `personal.png` — post-match PERSONAL tab
- [ ] `scoreboard-postmatch.png` — post-match TEAMS scoreboard
- [ ] `scoreboard-ingame.png` — in-game TAB scoreboard (different
  layout, right panel populated)
- [ ] `multi-hero.png` — match where the player swapped heroes
  (exercises `parseHeroesPlayed` ordering)
- [ ] `undated.png` — scoreboard-only match where `date` /
  `finished_at` aren't recoverable (exercises read-time
  inference paths)

## Privacy / licensing notes

These are Blizzard game screenshots taken by the maintainer. Two
things to consider before committing:

- **Blizzard IP**: Overwatch screenshots are user-generated content
  derived from Blizzard's game. Blizzard's historical EULA permits
  non-commercial sharing; this repo is Apache-2.0 and non-commercial.
  Re-check the current EULA if in doubt.
- **Other players' identities**: scoreboards display teammate /
  opponent BattleTags. Crop or pixelate non-self names before
  committing, or use solo-queue matches captured in custom games
  where names can be controlled. The parser doesn't read names,
  so blurring is harmless to test signal.

The maintainer's personal screenshot dump in `screenshots/` at the
repo root is gitignored for exactly these reasons; only deliberately-
curated fixtures land here.
