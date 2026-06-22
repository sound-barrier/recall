# Tesseract fine-tune spike — teaching the OW font

Follow-on to the EasyOCR-vs-Tesseract spike (`OCR-ENGINE-SPIKE.md`), which found
EasyOCR a few points more legible but not worth its ~2.5 GB PyTorch stack /
loss of the pure-Go single-binary model. The cheaper hypothesis: **don't switch
engines — fine-tune Tesseract's LSTM on the OW font.** This spike tests it.

## Verdict

**Fine-tuning works dramatically and is the high-ROI path.** Base Tesseract reads
isolated OW stat-numbers as pure garbage (100% char error); a tiny 400-iteration
fine-tune on 328 auto-labeled real crops drops CER to **2.4%** on a **leak-free
by-image split** (18 source screenshots held entirely out of training) — and it's
undertrained. It needs **no copyrighted font** (real crops, not synthetic), **no
new runtime dependency**, and **no architecture change** (still a shelled
Tesseract CLI — just ship an `ow.traineddata` beside the binary). This is the
recommendation from the OCR-engine question: tune Tesseract, don't replace it.

## Result

Held-out split — **18 source screenshots fully held out** (53 crops, **zero
train/eval image overlap**, verified):

| Model | Char error | Word error | Sample reads |
|---|---|---|---|
| Base `eng` (float) | **100.0%** | 100.0% | `2239`→`~Yyki` · `265`→`E13` · `527`→`Ey4` |
| Fine-tuned `ow` (400 iters) | **2.4%** | 5.7% | `2239`→`2239` ✓ · `6477`→`647` |

Training BCER fell 61% → 34% over the run and was still dropping (more iterations
would tighten it further). Total time: a few minutes on CPU.

A by-*crop* split (crops from one screenshot allowed on both sides) scored 2.9% —
essentially the same — so the result is **not** an artifact of leakage: the model
generalizes to screenshots it never saw, because the OW font renders consistently
across captures.

## Method

The hard part of any OW fine-tune is **labeled line crops** — the parser's regions
are multi-value, and the OW font is proprietary so synthetic generation is out
(and "Big Noodle" is copyrighted, so it can't be bundled anyway). The trick reuses
the previous spike's finding that **a neural detector localizes the OW numbers
Tesseract can't read**:

1. **`label.py`** runs RapidOCR (ONNX, ~150 MB, *local-only*, never committed) as
   a pure *detector*, keeps only detections whose digits match a known-correct
   value in the golden, and emits a tight crop of the **original** image (authentic
   OW rendering) + a `.gt.txt`. Ground truth is **verified against the golden**, not
   trusted to the detector.
2. **`train.sh`** turns each crop into a Tesseract `.lstmf`, holds out ~12% of
   source images (a **by-image** split — no screenshot in both train and eval),
   and fine-tunes the **float** `tessdata_best` `eng` LSTM (`--continue_from`; the
   system's fast integer model can't be trained), then `lstmeval`s base vs tuned.
3. **`setup.sh`** provisions the local-only tooling (RapidOCR venv, the box helper,
   the float `eng` model + `lstm.train` config).

**Data:** 382 GT-verified number crops from 181 images — **317 from the
`screenshots/` corpus** (owleague 237, nvidia 36, snip 15, openqueue 10, steam 8,
prntscreen 7, summary/rank 4) + 65 from `testdata/`. Digit lengths: 180×2, 52×3,
135×4, 15×5 — rich in the 3-4 digit rank-SR / damage values that are the parser's
weak spot.

## Honest caveats

- **CER is on isolated tight crops, not end-to-end through the parser.** Base
  `eng`'s 100% is the float model reading raw OW crops *without* the production
  preprocessing (invert/upscale) + per-region PSM + char whitelists that get
  production Tesseract to ~100% on the goldens. So 100% is not "production
  Tesseract is broken" — it's "the OW glyphs are off-distribution for a
  document-trained model, and fine-tuning fixes that." The end-to-end win still
  needs measuring (next steps).
- **Split is by image** — 18 source screenshots are held entirely out of training
  (verified zero train/eval image overlap), so the held-out CER reflects
  generalization, not memorization. (An earlier by-crop split scored the same,
  confirming leakage wasn't flattering the result.)
- **Auto-labeled GT biases toward detector-readable crops**; cases both engines
  miss aren't represented.
- **Digit-only** (GT is digits) and **undertrained** (400 iters). Tier words / hero
  names would be a separate labeling pass.

## If we productionize

1. **End-to-end eval first:** feed the parser's existing region crops to `-l ow`
   instead of `-l eng` and measure token-recall delta on `testdata/` (reuse the
   `OCR-ENGINE-SPIKE.md` harness). That's the number that decides it.
2. By-image split + more iterations for a defensible CER.
3. Distill `ow` to a fast integer model (~smaller) and ship it beside the binary —
   still pure-Go, still a shelled CLI, no new dependency.
4. Optionally extend GT to tier words (the documented `GOLD`→`GOD` garble) and hero
   names.

## Reproduce

```sh
bash spike/finetune/setup.sh            # local tools (gitignored): rapidocr venv, float eng, box helper
spike/finetune/.venv/bin/python spike/finetune/label.py \
  testdata screenshots/*               # -> spike/finetune/data/*.png + *.gt.txt
ITER=400 bash spike/finetune/train.sh   # fine-tune + before/after CER
```

Everything under `spike/finetune/` except the three scripts + `.gitignore` is
local and gitignored (venv, models, crops, checkpoints) — none of it is committed.
