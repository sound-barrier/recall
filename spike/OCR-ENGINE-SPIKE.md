# OCR engine spike — EasyOCR vs Tesseract

A staged spike to answer: **is EasyOCR better than Tesseract for reading Overwatch
screenshots?** Stage 1 (done, below) is a lightweight raw-OCR legibility comparison
over the 40 human-verified `testdata/` goldens. Reproduce with
`spike/ocr-compare.py` (see its header for the method).

## Verdict

**A modest accuracy edge that does not justify a wholesale switch — do not build
the Stage-2 seam-swap.** EasyOCR reads raw OW text a few points better than an
untuned Tesseract and needs *less* preprocessing, with real wins on the multi-digit
card numbers (rank SR, teams damage) that are the most hack-heavy part of today's
pipeline. But the gain is small at the raw-OCR layer — where the *production*
Tesseract pipeline already hits ~100% via tuned region crops — and the cost is
severe: EasyOCR is ~6× slower on CPU and pulls a ~2.5 GB PyTorch/Python stack that
**breaks the pure-Go, no-CGo, single-signed-binary distribution model that
`CLAUDE.md` calls load-bearing.** The only angle worth a future look is a *narrow,
opt-in* EasyOCR fallback for the numeric card regions where Tesseract is weakest —
not a replacement.

## Data (Stage 1)

40 `testdata/` image+golden pairs · 447 on-screen-text tokens · macOS CPU.

| Engine | What it is | Token recall | Wall time |
|---|---|---|---|
| `easy_raw` | EasyOCR on the original image | **74.3%** (332/447) | 475.2s |
| `easy_pre` | EasyOCR on Go's invert+3× preprocessing | 72.5% (324/447) | 480.7s |
| `tess_pre` | Tesseract `--psm 11` on the same preprocessing | 70.0% (313/447) | 73.8s |

By screenshot type:

| Type | easy_raw | easy_pre | tess_pre | Note |
|---|---|---|---|---|
| rank | **74%** | 73% | 68% | EasyOCR wins — the 4-digit SR cards |
| summary | **75%** | 65% | 73% | raw EasyOCR ≈ Tesseract; inversion hurts EasyOCR |
| personal | 78% | 76% | **79%** | Tesseract marginally ahead |
| teams | **83%** | 83% | 72% | EasyOCR wins — big damage/healing numbers |
| unknown | 17% | 17% | 17% | non-match career screen — noise, ignore |

## What the numbers mean

Three comparisons, each isolating one variable:

1. **EasyOCR vs untuned Tesseract** (`easy_raw` 74.3% vs `tess_pre` 70.0%, **+4.3 pts**)
   — EasyOCR's deep recognizer reads the stylized italic OW font modestly better
   out of the box.
2. **Same preprocessing, head to head** (`easy_pre` 72.5% vs `tess_pre` 70.0%,
   **+2.5 pts**) — the edge holds when both get the identical invert+upscale.
3. **Does EasyOCR even need the preprocessing?** (`easy_raw` 74.3% > `easy_pre` 72.5%,
   **+1.8 pts**) — no. The invert/upscale that Tesseract depends on slightly *hurts*
   EasyOCR. Its CRAFT detector handles white-on-dark game UI natively. A real
   maintenance point: EasyOCR would collapse the three preprocessing variants
   (`preprocessInverted` / `preprocessRaw` / `preprocessHighContrast`) into one
   raw pass.

**Critical framing:** this measures *raw OCR legibility*, not end-to-end field
extraction. Production Tesseract scores ~100% on these goldens (the golden test
passes) precisely because of ~30 tuned region crops + per-region PSM modes + char
whitelists that this full-image baseline deliberately omits. So `tess_pre` 70% is
**not** a knock on production Tesseract — and EasyOCR's +4 pts at the raw layer would
*not* translate into a clear end-to-end win without rebuilding the entire
regex/extraction/classification layer on top of it.

## Where each engine wins (the actionable part)

A clean qualitative split emerged in the `easy_pre` vs `tess_pre` disagreements:

- **EasyOCR reads multi-digit numbers in cards better.** Its exclusive wins are
  almost all 4-digit **rank SR** values (2697, 2312, 2481, 1799, 2144, 2689, 2690,
  1777…) and **teams** totals (6091, 481). These are exactly the regions the current
  pipeline fights hardest — the rank-SR panel needs a dual-PSM (6 ∪ 3) edge-stripped
  backfill to recover cards Tesseract mangles to 0 (see `parse_rank.go` and
  `testdata/README.md`). EasyOCR gets them in one pass.
- **Tesseract reads small values and hero names better in a few cases.** Its
  exclusive wins are small summary/personal integers (47, 33, 29, 20) and hero
  names (`lucio` ×2, `kiriko`), plus the orange `-19` demotion-progress text that
  EasyOCR missed (the colored-text case `preprocessRaw` exists for).

So the engines are complementary, not strictly ordered: **EasyOCR for dense
numerics, Tesseract for sparse labels.**

## Cost — why this isn't a switch

- **Speed:** EasyOCR ~11.9s/image vs Tesseract ~1.85s/image on CPU (**~6.4×**).
  GPU would close this, but a desktop app distributed to gamers can't assume CUDA.
- **Distribution:** EasyOCR is PyTorch + Python (~2.5 GB venv, models downloaded at
  runtime). Recall ships as a **single pure-Go, CGo-free, signed binary** that shells
  out to the Tesseract CLI — `CLAUDE.md` calls the pure-Go constraint load-bearing
  for the release pipeline. EasyOCR can't embed in that binary at all; it would mean
  bundling a Python runtime or running a sidecar service. That architectural cost
  dwarfs a ~4-point raw-legibility gain.
- **Determinism:** the goldens are baselined against a pinned Tesseract major.minor;
  a neural model adds version/weights drift to the regression baseline.

## Recommendation

1. **Do not pursue the wholesale swap. Do not build the Stage-2 Go seam-swap** (the
   `runTesseractFunc` → EasyOCR-worker + full golden test). A ~4-pt raw edge does not
   pay for a 6× slowdown plus losing the single-binary distribution model.
2. **If OCR accuracy becomes a priority, the highest-value narrow bet** is an
   **optional, server-mode-only** EasyOCR fallback for just the **rank-SR and teams
   numeric regions**, where it measurably beats Tesseract and the current code is
   most hack-heavy. Gate it behind a setting; never bundle torch into the desktop
   binary. This would be its own future spike.
3. **Cheap win available now regardless of engine:** EasyOCR doing *better on the
   raw image than on the inverted one* is a reminder that the preprocessing is tuned
   for Tesseract specifically — worth keeping in mind if the parser's preprocessing
   is ever revisited.

## Scope & caveats

- Metric is lenient token recall: substring match for strings, abs-value membership
  for integers (after the `digitize` letter→digit fold). Small/zero integers are a
  weak signal; multi-digit numbers and names are strong. Applied identically to both
  engines, so the *comparison* is fair even where absolute recall is soft.
- The `unknown` row (career-history screen) has almost no real on-screen tokens
  matching its full-`MatchResult` golden projection — treat as noise, not signal.
- `all_heroes` contributes no tokens (marker-only golden) and is excluded.
- Stage 1 is full-image; it gives EasyOCR no region cropping (which could help it)
  and Tesseract no production tuning (which would help it a lot). It answers "which
  engine reads the font better unaided," not "which pipeline is more accurate."

## Reproduce

```sh
screenshots/easyocr-project/.venv/bin/python spike/ocr-compare.py --corpus testdata
# --limit N for a quick smoke; --md PATH to write this report's data section
```

EasyOCR downloads its detector+recognizer weights (~tens of MB) on first run.
