#!/usr/bin/env python3
"""End-to-end check: does `tesseract -l ow` beat `-l eng` on OW number crops?

Runs the real tesseract binary with the parser's production-style invocation
(`--psm 7` + digit whitelist) over the **held-out** crops (the 18 source images
train.sh kept out of training), and reports exact-read accuracy for:

* ``eng_raw`` — base eng on the raw crop (apples-to-apples input with ow).
* ``eng_pre`` — base eng on the Go pipeline's invert+3x preprocessing (eng's
  best shot — its production form).
* ``ow_raw``  — the fine-tuned model on the raw crop (how ow is deployed).

Exact match = the whitelisted digit read equals the golden digit string.

Run inside the detector venv (needs PIL/numpy for the preprocessing variant):
    spike/finetune/.venv/bin/python spike/finetune/eval_e2e.py
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

TESSDATA = "spike/finetune/tessdata"
WHITELIST = "tessedit_char_whitelist=0123456789"


def tess(image: Path, lang: str, tessdata: str) -> str:
    proc = subprocess.run(  # noqa: S603 — fixed argv, no shell.
        [
            "tesseract",
            str(image),
            "stdout",
            "-l",
            lang,
            "--tessdata-dir",
            tessdata,
            "--psm",
            "7",
            "-c",
            WHITELIST,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    return re.sub(r"\D", "", proc.stdout)


def preprocess_inverted(src: Path, dest: Path) -> Path:
    """Replicate pkg/parser/imageutil.go::preprocessInverted (BT.601, invert, 3x)."""
    arr = np.asarray(Image.open(src).convert("RGB"), dtype=np.int64)
    lum = (299 * arr[..., 0] + 587 * arr[..., 1] + 114 * arr[..., 2]) // 1000
    inv = (255 - lum).astype(np.uint8)
    up = np.repeat(np.repeat(inv, 3, axis=0), 3, axis=1)
    Image.fromarray(up).save(dest)
    return dest


def held_out_crops(list_file: Path, data_dir: Path) -> list[Path]:
    if list_file.exists():
        crops = []
        for line in list_file.read_text().splitlines():
            png = Path(line.strip()).with_suffix(".png")
            if png.exists():
                crops.append(png)
        return crops
    return sorted(data_dir.glob("*.png"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tessdata", default=TESSDATA)
    parser.add_argument("--list", default="spike/finetune/train/list.eval")
    parser.add_argument("--data", default="spike/finetune/data")
    args = parser.parse_args()

    crops = held_out_crops(Path(args.list), Path(args.data))
    if not crops:
        print("no crops found", file=sys.stderr)
        return 1

    engines = ("eng_raw", "eng_pre", "ow_raw")
    correct = dict.fromkeys(engines, 0)
    ow_wins: list[str] = []
    ow_loses: list[str] = []

    with tempfile.TemporaryDirectory() as tmp:
        pre = Path(tmp) / "pre.png"
        for crop in crops:
            gt = crop.with_suffix(".gt.txt").read_text().strip()
            reads = {
                "eng_raw": tess(crop, "eng", args.tessdata),
                "eng_pre": tess(preprocess_inverted(crop, pre), "eng", args.tessdata),
                "ow_raw": tess(crop, "ow", args.tessdata),
            }
            for name, read in reads.items():
                if read == gt:
                    correct[name] += 1
            if reads["ow_raw"] == gt and reads["eng_pre"] != gt:
                ow_wins.append(
                    f"  {crop.name}: gt={gt} ow={reads['ow_raw']} eng_pre={reads['eng_pre'] or '∅'}"
                )
            if reads["eng_pre"] == gt and reads["ow_raw"] != gt:
                ow_loses.append(
                    f"  {crop.name}: gt={gt} eng_pre={reads['eng_pre']} ow={reads['ow_raw'] or '∅'}"
                )

    total = len(crops)
    print(f"\nHeld-out crops: {total}")
    print(f"{'engine':<10} exact-read accuracy")
    for name in engines:
        print(
            f"{name:<10} {100 * correct[name] / total:5.1f}%  ({correct[name]}/{total})"
        )
    print(f"\now beat eng_pre on {len(ow_wins)} crops:")
    print("\n".join(ow_wins[:20]) or "  (none)")
    print(f"\neng_pre beat ow on {len(ow_loses)} crops:")
    print("\n".join(ow_loses[:20]) or "  (none)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
