---
paths:
  - "pkg/parser/**"
---

# OCR parsers (`pkg/parser/`)

`ParseScreenshot` in `parser.go` dispatches by detector probes; each probe +
parser pair lives in its own file (`parse_rank.go`, `parse_summary.go`,
`parse_personal.go`, `parse_teams.go`):

- **Rank screen** (`isRankScreenshot` → `parseRank`): the competitive ladder
  badge + per-hero SR card.
- **SUMMARY tab** (`isSummaryScreenshot` → `parseSummary`): heroes played, total
  performance averages, map/result/score/date/game-length card.
- **PERSONAL tab** (`isPersonalScreenshot` → `parsePersonal`): 3×3 grid of
  hero-specific stat cards. Each cell gets dual-pass OCR (PSM 11 + PSM 6) plus an
  icon-stripped pass to recover labels Tesseract mangles against icon glyphs
  (Juno's orbital-ring icon turning "ORBITAL" into "ornBITAL" is the canonical
  example).
- **In-game / post-match TEAMS screen** (fall-through → `parseTeams`):
  finds the highlighted player row by brightest blue and OCRs its six stat
  columns (E/A/D, damage, healing, mitigation), plus the queue type from the
  players-per-team count. Nothing else on the scoreboard is read — hero-specific
  stats come only from PERSONAL.

OCR helpers (`ocr.go`): `ocrInverted` (default — luminance-inverted + 3×
upscaled, ideal for white-on-dark game UI), `ocrRaw` (grayscale, not inverted,
at the spec's scale — used only for the rank-progress value, colored text that
inversion flattens), `ocrThreshold` (hard bright-to-black cutoff — the rank screen's
occluded and low-contrast passes) and `ocrSmoothThreshold` (bilinear upscale
then cutoff — the TEAMS stat cells). Each stamps the region it read on the
spec; Tesseract itself is invoked by `pkg/tesseract` — no CGo binding.

## Field evidence

Every reading records the screenshot region its ACCEPTED pass came from on
`MatchResult.Evidence` (`evidence.go`), keyed by the same `FieldPath`
vocabulary the override system marks (`ScalarPath`, `HeroStatPath`,
`HeroPercentPath`, `SRPath`). A reader that tries several bands records the
band whose reading it kept, not the first it tried. Where the parser can find
the value's own ink inside that band it records that tighter box instead: the
SUMMARY E/A/D totals (`perfTotalBox`) and each rank card's four SR digits
(`srDigitBox`). Only a value the pixels produced records a region: a 0 read
off the screen does, the 0 left behind when no pass read anything does not.

Beside the region, `FieldEvidence.Template` holds what `pkg/glyphs`' digit
references read there — TEAMS stat cells, SUMMARY totals and each rank card's
SR — or nil when no reference matches with confidence. It is a cross-check only
and never changes the value OCR read. A rank card's SR pairs with `res.SR` in
reading order, so it is skipped when the card frames found and the names read
disagree in count or a name could not be placed in the panel text.

`Evidence` and `ImageSize` are `json:"-"`, so goldens never carry them;
`TestParseScreenshot_EvidenceCoversReadFields` holds the invariant over the
corpus instead. That test checks only the fields its per-type `readFields`
builders list (`integration_test.go`), so a new field a parser reads must
record its region AND be added to its type's builder — a field missing from the
builder is not checked.

## OCR fragility patterns

- Letter↔digit confusion in italic OW font: `digitize()` swaps O/Q/I/l/L back to
  digits in numeric captures.
- "AVG PER 10 MIN: X.XX" lines need anchoring on `MIN` so the `10` isn't grabbed
  as the value.
- The SUMMARY performance card (E/A/D + per-10-min avgs) is icon-noisy:
  `parsePerformance` segments per stat and picks the *largest digit line*,
  rejecting the crossed-swords icon's stray `"4"` and noise like `"S 4"`. It
  also normalizes the OW font's mis-OCR'd numeral glyphs (`O/Q→0`; `I/l/L` and
  the vertical brackets `|/]/[ →1`) so a value like `"11"` scanned as `"1]"` is
  recovered (else the icon's `4` wins). It still **over-reads on low-quality
  JPG** — a heavily-compressed PrintScreen capture read 74 eliminations where
  the TEAMS scoreboard (the reliable E/A/D source) read 9; the perf card is a
  fallback, not the source of truth, so cross-validate against TEAMS when both
  are present.
- The PERSONAL 3×3 grid **drops some hero-ability stat cells** — small-value,
  long-label ability stats (Charge Kill, Rip-Tire Kill, Immortality Field Death
  Prevented) are intermittently missing from `heroes_played[].Stats`, and a few
  labels OCR with typos (`EARTHSHATTER KILLS → earthshatiter_kills`). Captured
  *values* are correct; coverage isn't complete (open bug — see the openqueue
  tri-role PERSONAL goldens in `testdata/`).
- macOS `/tmp` is symlinked to `/private/tmp`; Tesseract sometimes fails to read
  PNG files at `/tmp/...` paths but works at `/private/tmp/...`. Affects debug
  runs only — production uses `os.MkdirTemp`.

## Classification & ordering

- **Per-screenshot detection runs in order**: rank → summary → personal →
  teams fallback. `isXScreenshot` probes are cheap (one OCR pass on a small
  region) and read-only.
- **Hero list ordering** in `heroes_played` is by `percent_played` desc (set by
  `parseSummary`). The "primary hero" stored at `data.hero` is the first/most-
  played entry. UI relies on this; don't shuffle.
- **`parser.HeroRole(hero string)`** is the exported way to get a hero's role
  label from outside the parser package. Don't reach into the unexported
  `heroRoles` map.

> Note: `Classify(r)` (`classify.go`, which `pkg/app/parse.go` stamps on each
> stored row) walks an ordered ladder — see `.claude/rules/app-shell.md`.

## Roster data (`heroes.yaml` + `maps.yaml`)

Both `//go:embed`'d in `owdata.go` and parsed at `init()` into
`parser.HeroesByRole` + `parser.MapsByType` (canonical display) plus normalized
lookup tables (`heroRoles`, `mapTypes`, `heroDisplayNames`, `mapDisplayNames`,
`knownMaps`). **Adding a hero/map: edit YAML, rebuild — no Go edits needed.**
`normalize()` (lowercase + diacritic-strip + colon-strip + whitespace-collapse)
handles diacritics ("Lúcio") and colons ("Soldier: 76"). Consumers:
`App.GetOWData()` (Wails / `/api/v1/system/reference-data`); `useOWData.ts`
(session-singleton → `heroDisplayName(stored)` / `mapDisplayName(stored)`).
**Hero-substring collision** ("Mizuki" can shadow "Mei" in OCR text with
BattleTags) is a known vector — `extractHeroes` is longest-match-wins. After a
YAML change, `task update-goldens` surfaces collisions when goldens flip.

## Test fixtures

Full-image parser tests live in `pkg/parser/integration_test.go`. **Images** are
in a git submodule — [`sound-barrier/recall-testdata`](https://github.com/sound-barrier/recall-testdata)
mounted at `testdata/images/` (default `RECALL_FIXTURE_DIR=../../testdata/images`
from the package's cwd); run `task fetch-fixtures` once after cloning or the
golden test skips. **Goldens** (`.golden.json`) stay in `testdata/` (default
`RECALL_GOLDEN_DIR=../../testdata`). A few images stay committed at `testdata/`
top level — the ones the README / docs site / e2e golden test embed by in-repo
path (submodules render as bare gitlinks on GitHub). See `testdata/README.md`
for the coverage checklist + the add-a-fixture flow (push to recall-testdata →
`git submodule update --remote testdata/images` → `task update-goldens`). To
curate from your own captures without touching the submodule, drop PNG files into a
private dir and run `task goldens SRC="$PWD/yourdir"` (or
`RECALL_FIXTURE_DIR="$PWD/yourdir"` alone — set without `RECALL_GOLDEN_DIR` it
writes goldens beside the images; **absolute path required**, the test binary's
cwd is `pkg/parser/`). `ci.yml` uses `-short` to skip the golden tests, so it
needs no submodule; `.github/workflows/golden-corpus.yml` runs them (nightly, and
on any PR touching `pkg/parser/**`, `pkg/glyphs/**` or `testdata/**`).
