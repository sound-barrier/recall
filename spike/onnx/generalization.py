#!/usr/bin/env python3
"""Does PP-OCR generalize to OW text the Tesseract pipeline wasn't tuned for?

The production pipeline hits ~100% on `testdata/` only because each failure was
hand-fixed (bug + added fixture). The brittle parts are the NON-number fields —
tier words (the GOLD->GOD garble), hero names — and untested ranks/roles. This
probe asks: does a strong general OCR (PP-OCR via RapidOCR) read those fields
*without* per-case tuning?

For every corpus image it runs **PP-OCR (full det+rec)** and **untuned Tesseract**
(the parser's invert/upscale preprocessing, `--psm 11`, no per-region whitelist)
on the whole image, and scores recall of the golden tokens **by field category**,
split into:

* `testdata`   — 40 hand-verified goldens (ground truth; the *tuned* set).
* `screenshots`— ~140 auto-goldens Tesseract was NEVER hand-tuned/verified on
  (the generalization frontier).

High PP-OCR recall on the brittle fields (tier/hero) across the untuned split,
especially vs untuned Tesseract, is the structural case that PP-OCR needs less
hand-tuning.

Run inside the RapidOCR venv:
    spike/finetune/.venv/bin/python spike/onnx/generalization.py
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

import numpy as np
from PIL import Image

IMAGE_EXTS = (".png", ".jpg", ".jpeg")
CORPORA = {
    "testdata": [Path("testdata")],
    "screenshots": [
        Path("screenshots") / d
        for d in (
            "nvidia",
            "owleague",
            "steam",
            "prntscreen",
            "rank",
            "summary",
            "openqueue",
            "snip",
        )
    ],
}
CATEGORIES = ("tier", "hero", "result", "map", "modifier", "number")
_DIGITIZE = str.maketrans(
    {"O": "0", "o": "0", "Q": "0", "q": "0", "I": "1", "l": "1", "L": "1"}
)
_INT_RUN = re.compile(r"\d[\d,]*")


def strip_accents(text: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c)
    )


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", strip_accents(text).lower()).strip()


def int_set(text: str) -> set[int]:
    folded = text.translate(_DIGITIZE)
    return {int(m.replace(",", "")) for m in _INT_RUN.findall(folded)}


def categorized_tokens(result: dict) -> dict[str, tuple[set[str], set[int]]]:
    """Golden tokens split by field category (strings, ints)."""
    cats: dict[str, tuple[set[str], set[int]]] = {c: (set(), set()) for c in CATEGORIES}

    def add_str(cat: str, value: object) -> None:
        if isinstance(value, str) and value.strip():
            cats[cat][0].add(value.strip())

    def add_int(cat: str, value: object) -> None:
        if isinstance(value, bool) or not isinstance(value, int):
            return
        if abs(value) >= 10:  # multi-digit; single digits are ambiguous noise
            cats[cat][1].add(abs(value))

    add_str("tier", result.get("rank"))
    add_str("result", result.get("result"))
    add_str("map", result.get("map"))
    add_str("hero", result.get("hero"))
    for modifier in result.get("modifiers") or []:
        add_str("modifier", modifier)
    for key in ("eliminations", "assists", "deaths", "damage", "healing", "mitigation"):
        add_int("number", result.get(key))
    for hero_play in result.get("heroes_played") or []:
        add_str("hero", hero_play.get("hero"))
        for stat_value in (hero_play.get("stats") or {}).values():
            add_int("number", stat_value)
    for sr_row in result.get("sr") or []:
        add_str("hero", sr_row.get("hero"))
        add_int("number", sr_row.get("sr"))
    return cats


def preprocess_inverted(img: Image.Image) -> np.ndarray:
    arr = np.asarray(img.convert("RGB"), dtype=np.int64)
    lum = (299 * arr[..., 0] + 587 * arr[..., 1] + 114 * arr[..., 2]) // 1000
    inv = (255 - lum).astype(np.uint8)
    up = np.repeat(np.repeat(inv, 3, axis=0), 3, axis=1)
    return np.stack([up, up, up], axis=-1)


def tesseract_text(rgb: np.ndarray) -> str:
    tmp = Path(".gen-tmp.png")
    Image.fromarray(rgb).save(tmp)
    try:
        proc = subprocess.run(  # noqa: S603 — fixed argv, no shell.
            ["tesseract", str(tmp), "-", "--psm", "11"],
            capture_output=True,
            text=True,
            check=False,
        )
        return proc.stdout
    finally:
        tmp.unlink(missing_ok=True)


def score(text: str, strs: set[str], ints: set[int]) -> tuple[int, int]:
    hay = norm(text)
    nums = int_set(text)
    hit = sum(1 for t in strs if norm(t) in hay) + sum(1 for v in ints if v in nums)
    return hit, len(strs) + len(ints)


def find_pairs(corpus_dirs: list[Path]) -> list[tuple[Path, Path]]:
    pairs = []
    for corpus in corpus_dirs:
        for golden in sorted(corpus.glob("*.golden.json")):
            image = golden.with_name(golden.name[: -len(".golden.json")])
            if image.suffix.lower() in IMAGE_EXTS and image.exists():
                pairs.append((image, golden))
    return pairs


def main() -> int:
    print("loading RapidOCR (full det+rec) ...", file=sys.stderr)
    from rapidocr_onnxruntime import RapidOCR  # noqa: PLC0415

    engine = RapidOCR()

    # tallies[split][engine][category] = [matched, total]
    tallies: dict[str, dict[str, dict[str, list[int]]]] = {
        split: {eng: {c: [0, 0] for c in CATEGORIES} for eng in ("ppocr", "tess")}
        for split in CORPORA
    }
    tier_miss: list[str] = []
    hero_miss: list[str] = []

    for split, dirs in CORPORA.items():
        pairs = find_pairs(dirs)
        for idx, (image, golden) in enumerate(pairs, 1):
            result = json.loads(golden.read_text()).get("result") or {}
            cats = categorized_tokens(result)
            if not any(s or i for s, i in cats.values()):
                continue
            pil = Image.open(image)
            det = engine(np.asarray(pil.convert("RGB")))[0]
            ppocr_text = " ".join(box[1] for box in det) if det else ""
            tess_txt = tesseract_text(preprocess_inverted(pil))
            for cat, (strs, ints) in cats.items():
                for eng, text in (("ppocr", ppocr_text), ("tess", tess_txt)):
                    hit, total = score(text, strs, ints)
                    tallies[split][eng][cat][0] += hit
                    tallies[split][eng][cat][1] += total
            # eyeball list: brittle fields PP-OCR missed (untuned screenshots only)
            if split == "screenshots":
                for tok in cats["tier"][0]:
                    if norm(tok) not in norm(ppocr_text):
                        tier_miss.append(
                            f"  {image.name}: tier '{tok}' not in PP-OCR text"
                        )
                for tok in cats["hero"][0]:
                    if norm(tok) not in norm(ppocr_text):
                        hero_miss.append(
                            f"  {image.name}: hero '{tok}' not in PP-OCR text"
                        )
            print(f"[{split} {idx}/{len(pairs)}] {image.name}", file=sys.stderr)

    print(render(tallies, tier_miss, hero_miss))
    return 0


def render(tallies: dict, tier_miss: list[str], hero_miss: list[str]) -> str:
    out = ["# PP-OCR vs untuned Tesseract — recall by field category", ""]
    for split in CORPORA:
        label = (
            "testdata (hand-verified truth)"
            if split == "testdata"
            else "screenshots (untuned — generalization frontier)"
        )
        out += [
            f"## {label}",
            "",
            "| Field | PP-OCR | untuned Tesseract |",
            "|---|---|---|",
        ]
        for cat in CATEGORIES:
            row = []
            for eng in ("ppocr", "tess"):
                m, t = tallies[split][eng][cat]
                row.append(f"{100 * m / t:.0f}% ({m}/{t})" if t else "—")
            out.append(f"| {cat} | {row[0]} | {row[1]} |")
        out.append("")
    out += [
        "## Brittle-field misses on the untuned screenshots (eyeball these)",
        "",
        "### Tier words PP-OCR did not read",
        "",
    ]
    out += tier_miss[:25] or ["  (none)"]
    out += ["", "### Hero names PP-OCR did not read", ""]
    out += hero_miss[:25] or ["  (none)"]
    out.append("")
    return "\n".join(out)


if __name__ == "__main__":
    raise SystemExit(main())
