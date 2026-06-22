# Tesseract fine-tune spike — teaching the OW font

Follow-on to the EasyOCR-vs-Tesseract spike (`OCR-ENGINE-SPIKE.md`), which found
EasyOCR a few points more legible but not worth its ~2.5 GB PyTorch stack /
loss of the pure-Go single-binary model. The cheaper hypothesis: **don't switch
engines — fine-tune Tesseract's LSTM on the OW font.** This spike tested it, and
the answer flipped once it was measured properly.

## Verdict

**Not worth it — and the end-to-end test reversed the spike's own apparent win.**
A crop-level metric made fine-tuning look dramatic (char error 100% → 2.4%), but
that compared base `eng` *without* the preprocessing and digit whitelist the
parser actually applies. Invoke the real `tesseract -l eng` vs `-l ow` the way the
parser does (invert/upscale + `tessedit_char_whitelist`), and **base `eng` already
reads OW numbers at ~100% while the fine-tuned model is worse (79%).** The problem
the fine-tune "solved" is one the production pipeline doesn't have. **Don't
productionize it** — the existing per-region preprocessing + whitelist is already
the right tool.

## End-to-end result (the decisive test)

`tesseract -l <model>` on the 53 held-out crops, with the parser's production
invocation (`--psm 7` + digit whitelist). Run via `spike/finetune/eval_e2e.py`:

| Invocation | Exact-read accuracy |
|---|---|
| Base `eng`, raw crop | 96.2% (51/53) |
| Base `eng`, **production preprocessing** (invert/3×) | **100.0% (53/53)** |
| Fine-tuned `ow`, raw crop | 79.2% (42/53) |

`ow` beat `eng_pre` on **0** crops; `eng_pre` beat `ow` on 11 — the fine-tuned
model hallucinates extra digits (`3474`→`308474`, `1799`→`11799`, `1007`→`11007`).

## The misleading intermediate result

`lstmeval` on the *same* held-out crops told the opposite story:

| Model | Char error |
|---|---|
| Base `eng` (float, **no preprocessing, no whitelist**) | 100.0% |
| Fine-tuned `ow` (400 iters) | 2.4% |

This is what made fine-tuning look like a slam-dunk — and it's the trap. `lstmeval`
feeds the raw LSTM recognizer with no digit constraint, so base `eng` emits garbage
(`2239`→`~Yyki`). The fine-tune learned to read raw OW digit crops, so it scores
great *there*. But the parser never invokes Tesseract that way — it preprocesses
and whitelists, which already fixes base `eng`. **A crop-level CER win means nothing
until you measure it through the real invocation.** (Thanks to the reviewer who
insisted on the end-to-end test — it's the whole story.)

## Method (the labeling trick is the reusable part)

The hard part of any OW fine-tune is **labeled line crops**: the parser's regions
are multi-value, and the OW font is proprietary so synthetic generation is out
(and "Big Noodle" is copyrighted — can't be bundled). The trick reuses the EasyOCR
spike's finding that a neural detector localizes OW numbers well:

1. **`label.py`** runs RapidOCR (ONNX, ~150 MB, *local-only*, never committed) as a
   pure *detector*, keeps only detections whose digits match a known-correct value
   in the golden, and emits a tight crop of the **original** image + a `.gt.txt`.
   Ground truth is **verified against the golden**, not trusted to the detector.
2. **`train.sh`** turns each crop into a `.lstmf`, holds out ~12% of source images
   (a **by-image** split — verified zero train/eval image overlap), and fine-tunes
   the **float** `tessdata_best` `eng` LSTM (the system's fast integer model can't
   be trained), then `lstmeval`s base vs tuned.
3. **`eval_e2e.py`** runs the production-style `-l eng` vs `-l ow` comparison — the
   one that actually decided the spike.
4. **`setup.sh`** provisions the local-only tooling.

**Data:** 382 GT-verified number crops from 181 images — **317 from `screenshots/`**
(owleague 237, nvidia 36, snip 15, …) + 65 from `testdata/`, rich in the 3-4 digit
rank-SR / damage values.

## What we learned

- **The parser's design is already well-matched to the OW font.** Tight region
  crops + invert/upscale + per-region digit whitelist get base Tesseract to ~100%
  on these numbers. Fine-tuning addressed a non-problem and regressed it.
- **Always validate a model/engine change through the real invocation.** The
  crop-level CER (100% → 2.4%) was real but irrelevant; the production-faithful
  number (100% vs 79%) is the opposite.
- The auto-labeling trick (neural detector localizes, golden verifies GT) and the
  by-image-split harness are reusable **if** a genuine OCR weakness is ever found —
  but check the preprocessing + whitelist first; that's usually the real lever.

## Reproduce

```sh
bash spike/finetune/setup.sh                                  # local tools (gitignored)
spike/finetune/.venv/bin/python spike/finetune/label.py testdata screenshots/*
ITER=400 bash spike/finetune/train.sh                        # crop-level CER (misleading)
spike/finetune/.venv/bin/python spike/finetune/eval_e2e.py   # end-to-end -l eng vs -l ow (decisive)
```

Everything under `spike/finetune/` except the four scripts + `.gitignore` is local
and gitignored (venv, models, crops, checkpoints) — none of it is committed.
