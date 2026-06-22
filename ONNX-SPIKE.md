# PP-OCR generalization spike — is the OCR *engine* the bottleneck?

The Tesseract pipeline's "100%" on `testdata/` is survivorship bias — each failure
was hand-fixed (bug + added fixture). The worry: it won't generalize to untested
tiers (Bronze/Champion/Diamond), tank/support layouts, or unseen heroes, and the
brittle bits are the non-number fields (tier words like the `GOLD`→`GOD` garble,
hero names). This spike asks whether a strong general OCR (PaddleOCR PP-OCR, via
RapidOCR) reads those fields better — i.e. whether **swapping the engine** would
de-risk generalization.

## Verdict

**No — the OCR engine is not the bottleneck, so don't swap it.** On the exact
brittle fields, **PP-OCR and *untuned* Tesseract are equal** (tier 100%/100%, hero
98%/98%) on both the hand-tuned `testdata` and the ~140 screenshots Tesseract was
never tuned on. The production pipeline's tier brittleness is a **tight-crop
artifact** — on the *full image*, plain Tesseract reads tier words at 100%. The
generalization lever is the **parser's region cropping + whitelisting**, not the
recognition engine. Shipping PP-OCR (the Tier A in-process prototype) was **not
built** — it's moot if it doesn't help.

## Data — recall by field, PP-OCR vs untuned Tesseract

"Untuned Tesseract" = the parser's invert/upscale preprocessing, `--psm 11`, on the
**whole image**, no per-region whitelist. PP-OCR = RapidOCR full det+rec.

### testdata (40 hand-verified goldens = ground truth)

| Field | PP-OCR | untuned Tesseract |
|---|---|---|
| tier | 100% (24/24) | 100% (24/24) |
| hero | 98% (61/62) | 98% (61/62) |
| result | 100% (29/29) | 93% (27/29) |
| map | 100% (5/5) | 100% (5/5) |
| modifier | 95% (42/44) | 98% (43/44) |
| number | 97% (75/77) | 83% (64/77) |

### screenshots (~140 auto-goldens — never hand-tuned; the generalization frontier)

| Field | PP-OCR | untuned Tesseract |
|---|---|---|
| tier | 100% (24/24) | 100% (24/24) |
| hero | 98% (183/187) | 98% (183/187) |
| result | 100% (54/54) | 69% (37/54) |
| map | 87% (26/30) | 90% (27/30) |
| modifier | 98% (42/43) | 98% (42/43) |
| number | 96% (400/417) | 95% (396/417) |

## What it means

- **Tier words — both 100%, everywhere.** Even *untuned* Tesseract reads
  `PLATINUM`/`GOLD`/etc. perfectly on the full image. The `GOLD`→`GOD` garble that
  needed hand-fixing was the parser cropping a **too-tight band**, not a Tesseract
  capability gap. PP-OCR gives nothing here. New tier words (Bronze/Champion/
  Diamond) are just more text both engines read on the full image — the risk is the
  *crop*, which PP-OCR wouldn't change.
- **Hero names — both 98%.** PP-OCR no better; both miss the same handful (mostly
  `lúcio`, likely shown by portrait rather than as text on those frames — not an OCR
  failure either engine fixes).
- **PP-OCR's only real edges** are `result` (100% vs 69–93%) and *untuned* `number`
  reading (97% vs 83% on testdata) — but the production pipeline already reads
  numbers near-perfectly via its tuned crops + whitelists (see `OCR-ENGINE-SPIKE` /
  the fine-tune spike), and `result` is often inferred, not OCR'd. Neither bears on
  the tier/role/hero generalization worry.

**So the generalization fix, if one is needed, is in the parser** — read tiers from
a wider band, loosen the per-region whitelists, make region detection layout-robust
— **not in replacing Tesseract.**

## Why Part 2 (in-process PP-OCR / Tier A) was not built

The plan gated the distribution prototype on this result. Since PP-OCR doesn't
improve the brittle fields, shipping it isn't worth the cost. For the record, the
Tier A distribution facts (gathered, not prototyped):

- **Footprint:** `libonnxruntime` 29 MB + PP-OCRv3 rec model 11 MB ≈ **~40 MB/OS**.
- **CGo:** `onnxruntime-go` links the C++ runtime — fine for the already-per-OS-CGo
  desktop Wails builds, costlier for the pure-Go server cross-compile.
- All Apache-2.0/MIT (no licensing blocker). The rec model embeds its 6623-char
  dict in ONNX metadata. None of this is worth pursuing given the verdict.

## Caveats

- The corpus has **no Bronze/Champion/Diamond or explicit tank/support** captures,
  so generalization to those is inferred — but since both engines read arbitrary
  tier *words* equally on the full image, there's no engine-level reason to expect
  divergence on new tier words. (To test directly, add such screenshots.)
- `screenshots/` goldens are Tesseract auto-output, so recall-vs-golden there is
  partly agreement-with-Tesseract — but the **testdata split is ground truth** and
  shows the same engine equality, so the conclusion holds.
- This is full-image OCR, not the parser's region pipeline; it isolates **engine
  capability**, which is exactly the question ("would a better engine help?").

## Reproduce

```sh
spike/finetune/.venv/bin/python spike/onnx/generalization.py
```

Needs the RapidOCR venv from the fine-tune spike (`spike/finetune/setup.sh`) +
`tesseract` on PATH. The venv/models stay gitignored; only this script + writeup
are committed.
