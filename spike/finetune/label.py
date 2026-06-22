#!/usr/bin/env python3
"""Auto-label real OW-rendered number crops for a Tesseract digit fine-tune.

The parser's crop regions are multi-value, so they don't give clean line+GT
pairs. Instead we use a neural OCR engine (RapidOCR, run locally — never
committed) purely as a *detector*: it localizes the OW numbers Tesseract
mangles, then we keep only the detections whose digits match a known-correct
value in the golden — so the ground truth is verified, not trusted to the
detector. Each kept detection becomes a tight crop of the ORIGINAL image
(authentic OW rendering) + a `.gt.txt` of the digit string.

Output: spike/finetune/data/<id>.png + <id>.gt.txt pairs.

Run inside the local detector venv:
    spike/finetune/.venv/bin/python spike/finetune/label.py \
        testdata screenshots/owleague screenshots/nvidia ... --out spike/finetune/data
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image

IMAGE_EXTS = (".png", ".jpg", ".jpeg")
_DIGITIZE = str.maketrans(
    {"O": "0", "o": "0", "Q": "0", "q": "0", "I": "1", "l": "1", "L": "1"}
)
_PURE_DIGITS = re.compile(r"^\d+$")
MIN_CONF = 0.4
MIN_PX = 8  # drop slivers EasyOCR sometimes emits
PAD = 4


def golden_ints(result: dict) -> set[str]:
    """The integer values a golden asserts, as bare digit strings (abs)."""
    ints: set[int] = set()

    def add(value: object) -> None:
        if isinstance(value, bool):
            return
        if isinstance(value, int):
            ints.add(abs(value))

    for key in (
        "eliminations",
        "assists",
        "deaths",
        "damage",
        "healing",
        "mitigation",
        "level",
    ):
        add(result.get(key))
    for hero_play in result.get("heroes_played") or []:
        for stat_value in (hero_play.get("stats") or {}).values():
            add(stat_value)
    for sr_row in result.get("sr") or []:
        add(sr_row.get("sr"))
        add(sr_row.get("change"))
    # Keep multi-digit values; single digits ("0"/"5") are ambiguous noise and
    # already abundant — fine-tuning gains live in the 3-4 digit card numbers.
    return {str(v) for v in ints if v >= 10}


def find_pairs(corpus_dirs: list[Path]) -> list[tuple[Path, Path]]:
    pairs = []
    suffix = ".golden.json"
    for corpus in corpus_dirs:
        for golden in sorted(corpus.glob("*" + suffix)):
            image = golden.with_name(golden.name[: -len(suffix)])
            if image.suffix.lower() in IMAGE_EXTS and image.exists():
                pairs.append((image, golden))
    return pairs


def bbox_to_rect(bbox: list, w: int, h: int) -> tuple[int, int, int, int] | None:
    xs = [int(p[0]) for p in bbox]
    ys = [int(p[1]) for p in bbox]
    x0 = max(0, min(xs) - PAD)
    y0 = max(0, min(ys) - PAD)
    x1 = min(w, max(xs) + PAD)
    y1 = min(h, max(ys) + PAD)
    if x1 - x0 < MIN_PX or y1 - y0 < MIN_PX:
        return None
    return x0, y0, x1, y1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("corpus", nargs="+", help="dirs of <image>+<image>.golden.json")
    parser.add_argument("--out", default="spike/finetune/data")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    pairs = find_pairs([Path(c) for c in args.corpus])
    if args.limit:
        pairs = pairs[: args.limit]
    if not pairs:
        print("no image+golden pairs found", file=sys.stderr)
        return 1

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    print(f"loading RapidOCR; labeling {len(pairs)} images ...", file=sys.stderr)
    from rapidocr_onnxruntime import RapidOCR  # noqa: PLC0415

    engine = RapidOCR()

    kept = 0
    for idx, (image, golden) in enumerate(pairs, 1):
        result = json.loads(golden.read_text()).get("result") or {}
        wanted = golden_ints(result)
        if not wanted:
            continue
        pil = Image.open(image).convert("RGB")
        w, h = pil.size
        result, _ = engine(np.asarray(pil))
        detections = result or []
        per_image = 0
        for det_idx, (bbox, text, score) in enumerate(detections):
            if float(score) < MIN_CONF:
                continue
            digits = text.translate(_DIGITIZE)
            digits = re.sub(r"[,\s]", "", digits)
            if not _PURE_DIGITS.match(digits) or digits not in wanted:
                continue
            rect = bbox_to_rect(bbox, w, h)
            if rect is None:
                continue
            stem = f"{image.parent.name}_{idx:03d}_{det_idx:02d}"
            pil.crop(rect).save(out / f"{stem}.png")
            (out / f"{stem}.gt.txt").write_text(digits + "\n")
            per_image += 1
            kept += 1
        print(
            f"[{idx}/{len(pairs)}] {image.name}: +{per_image} (total {kept})",
            file=sys.stderr,
        )

    print(f"\nwrote {kept} labeled crops to {out}/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
