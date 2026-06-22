#!/usr/bin/env python3
"""Spike: EasyOCR vs Tesseract raw-OCR legibility on Recall's golden fixtures.

For each ``<image>`` + ``<image>.golden.json`` pair in a corpus dir, derive the
set of on-screen-text tokens the golden asserts (map, hero names, integer stats,
SR, rank tier, modifiers, ...), then run three OCR passes and score each by token
recall:

* ``easy_raw``  — EasyOCR on the original image (does it need preprocessing?).
* ``easy_pre``  — EasyOCR on the Go pipeline's primary preprocessing.
* ``tess_pre``  — Tesseract ``--psm 11`` on the same preprocessing (untuned).

This measures RAW legibility on identical preprocessing, NOT end-to-end field
extraction: production Tesseract hits ~100% on these goldens via ~30 tuned region
crops + per-region PSM/whitelist, which this full-image baseline omits. The
meaningful comparisons are easy_pre vs tess_pre (same footing) and easy_raw vs
easy_pre (does EasyOCR need the invert/upscale at all).

Run inside the EasyOCR venv:
    screenshots/easyocr-project/.venv/bin/python spike/ocr-compare.py \
        --corpus testdata --md OCR-ENGINE-SPIKE.md
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image

IMAGE_EXTS = (".png", ".jpg", ".jpeg")

# Golden keys whose values appear verbatim as on-screen TEXT. Derived /
# format-normalized fields (role, game_mode, playlist, queue_type, date,
# finished_at, game_length, play_time, performance averages, *_raw) are excluded
# so the engines aren't penalized for values that were computed, not read.
STR_KEYS = ("map", "hero", "result", "rank", "final_score")
INT_KEYS = (
    "eliminations",
    "assists",
    "deaths",
    "damage",
    "healing",
    "mitigation",
    "level",
    "rank_progress",
    "change_percent",
)

# Mirror pkg/parser/text.go::digitize — fold the OW font's letter->digit
# confusions before pulling integers out of OCR text.
_DIGITIZE = str.maketrans(
    {"O": "0", "o": "0", "Q": "0", "q": "0", "I": "1", "l": "1", "L": "1"}
)
_INT_RUN = re.compile(r"\d[\d,]*")


@dataclass
class EngineScore:
    """Per-engine running tally across the corpus."""

    matched: int = 0
    total: int = 0
    seconds: float = 0.0
    by_type_matched: dict[str, int] = field(default_factory=dict)
    by_type_total: dict[str, int] = field(default_factory=dict)

    def add(self, stype: str, matched: int, total: int) -> None:
        self.matched += matched
        self.total += total
        self.by_type_matched[stype] = self.by_type_matched.get(stype, 0) + matched
        self.by_type_total[stype] = self.by_type_total.get(stype, 0) + total

    def recall(self) -> float:
        return self.matched / self.total if self.total else 0.0


def strip_accents(text: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c)
    )


def norm(text: str) -> str:
    """Lowercase, accent-stripped, whitespace-collapsed — for substring matching."""
    return re.sub(r"\s+", " ", strip_accents(text).lower()).strip()


def int_set(text: str) -> set[int]:
    """Integers readable from OCR text after digitize folding (commas stripped)."""
    folded = text.translate(_DIGITIZE)
    return {int(m.replace(",", "")) for m in _INT_RUN.findall(folded)}


def collect_tokens(result: dict) -> tuple[list[str], list[int]]:
    """Pull the on-screen string + integer tokens a golden asserts."""
    strs: list[str] = []
    ints: list[int] = []

    def add_str(value: object) -> None:
        if isinstance(value, str) and value.strip():
            strs.append(value.strip())

    def add_int(value: object) -> None:
        # bool is an int subclass; the all_heroes marker must not become a token.
        if isinstance(value, bool):
            return
        if isinstance(value, int):
            ints.append(value)

    for key in STR_KEYS:
        add_str(result.get(key))
    for key in INT_KEYS:
        add_int(result.get(key))
    for modifier in result.get("modifiers") or []:
        add_str(modifier)
    for hero_play in result.get("heroes_played") or []:
        add_str(hero_play.get("hero"))
        add_int(hero_play.get("percent_played"))
        for stat_value in (hero_play.get("stats") or {}).values():
            add_int(stat_value)
    for sr_row in result.get("sr") or []:
        add_str(sr_row.get("hero"))
        add_int(sr_row.get("sr"))
        add_int(sr_row.get("change"))
    return strs, ints


def score_tokens(
    text: str, strs: list[str], ints: list[int]
) -> tuple[set[str], set[str]]:
    """Return (hit, miss) token labels for one engine's OCR text."""
    hay = norm(text)
    nums = int_set(text)
    hit: set[str] = set()
    miss: set[str] = set()
    for token in strs:
        label = f"str:{token}"
        (hit if norm(token) in hay else miss).add(label)
    for value in ints:
        label = f"int:{value}"
        (hit if abs(value) in nums else miss).add(label)
    return hit, miss


def preprocess_inverted(img: Image.Image) -> np.ndarray:
    """Replicate pkg/parser/imageutil.go::preprocessInverted (BT.601, invert, 3x)."""
    arr = np.asarray(img.convert("RGB"), dtype=np.int64)
    lum = (299 * arr[..., 0] + 587 * arr[..., 1] + 114 * arr[..., 2]) // 1000
    inv = (255 - lum).astype(np.uint8)
    up = np.repeat(np.repeat(inv, 3, axis=0), 3, axis=1)
    return np.stack([up, up, up], axis=-1)


def tesseract_text(rgb: np.ndarray, tess_bin: str) -> str:
    tmp = Path(".ocr-spike-tmp.png")
    Image.fromarray(rgb).save(tmp)
    try:
        proc = subprocess.run(  # noqa: S603 — fixed argv, no shell.
            [tess_bin, str(tmp), "-", "--psm", "11"],
            capture_output=True,
            text=True,
            check=False,
        )
        return proc.stdout
    finally:
        tmp.unlink(missing_ok=True)


def find_pairs(corpus: Path) -> list[tuple[Path, Path]]:
    pairs = []
    suffix = ".golden.json"
    for golden in sorted(corpus.glob("*" + suffix)):
        # "<image>.png.golden.json" -> "<image>.png" (two suffixes, not one).
        image = golden.with_name(golden.name[: -len(suffix)])
        if image.suffix.lower() in IMAGE_EXTS and image.exists():
            pairs.append((image, golden))
    return pairs


def fmt_pct(score: EngineScore) -> str:
    return f"{100 * score.recall():.1f}% ({score.matched}/{score.total})"


def render_markdown(
    pairs_done: int,
    engines: dict[str, EngineScore],
    types: list[str],
    wins: list[str],
    losses: list[str],
) -> str:
    lines = ["# OCR engine spike — EasyOCR vs Tesseract (raw-legibility data)", ""]
    lines.append(
        f"Corpus: {pairs_done} `testdata/` image+golden pairs. "
        "Metric: token recall (see header of `spike/ocr-compare.py`)."
    )
    lines.append("")
    lines.append("## Overall token recall")
    lines.append("")
    lines.append("| Engine | Recall | Wall time |")
    lines.append("|---|---|---|")
    for name in ("easy_raw", "easy_pre", "tess_pre"):
        eng = engines[name]
        lines.append(f"| `{name}` | {fmt_pct(eng)} | {eng.seconds:.1f}s |")
    lines.append("")
    lines.append("## Recall by screenshot type")
    lines.append("")
    lines.append("| Type | easy_raw | easy_pre | tess_pre |")
    lines.append("|---|---|---|---|")
    for stype in types:
        cells = []
        for name in ("easy_raw", "easy_pre", "tess_pre"):
            eng = engines[name]
            tot = eng.by_type_total.get(stype, 0)
            mat = eng.by_type_matched.get(stype, 0)
            cells.append(f"{100 * mat / tot:.0f}% ({mat}/{tot})" if tot else "—")
        lines.append(f"| {stype} | {cells[0]} | {cells[1]} | {cells[2]} |")
    lines.append("")
    lines.append("## Disagreements (same preprocessing: easy_pre vs tess_pre)")
    lines.append("")
    lines.append("### EasyOCR read it, Tesseract missed it")
    lines.append("")
    lines.extend(wins or ["_none_"])
    lines.append("")
    lines.append("### Tesseract read it, EasyOCR missed it")
    lines.append("")
    lines.extend(losses or ["_none_"])
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--corpus", default="testdata", help="dir of <image>+<image>.golden.json"
    )
    parser.add_argument("--limit", type=int, default=0, help="cap pairs (smoke test)")
    parser.add_argument(
        "--md", default="", help="write the markdown report to this path"
    )
    parser.add_argument("--tesseract", default="tesseract", help="tesseract binary")
    args = parser.parse_args()

    corpus = Path(args.corpus)
    pairs = find_pairs(corpus)
    if args.limit:
        pairs = pairs[: args.limit]
    if not pairs:
        print(f"no image+golden pairs under {corpus}", file=sys.stderr)
        return 1

    print(
        f"loading EasyOCR (CPU); {len(pairs)} pairs from {corpus}/ ...", file=sys.stderr
    )
    import easyocr  # noqa: PLC0415 — defer the heavy import until after arg parsing.

    reader = easyocr.Reader(["en"], gpu=False, verbose=False)

    engines = {name: EngineScore() for name in ("easy_raw", "easy_pre", "tess_pre")}
    seen_types: list[str] = []
    wins: list[str] = []
    losses: list[str] = []

    for idx, (image, golden) in enumerate(pairs, 1):
        snapshot = json.loads(golden.read_text())
        stype = snapshot.get("screenshot_type", "unknown")
        strs, ints = collect_tokens(snapshot.get("result") or {})
        total = len(strs) + len(ints)
        if stype not in seen_types:
            seen_types.append(stype)
        if total == 0:
            print(
                f"[{idx}/{len(pairs)}] {image.name}: no tokens ({stype}) — skipped",
                file=sys.stderr,
            )
            continue

        pil = Image.open(image)
        raw_rgb = np.asarray(pil.convert("RGB"))
        pre_rgb = preprocess_inverted(pil)

        texts: dict[str, str] = {}
        start = time.perf_counter()
        texts["easy_raw"] = " ".join(
            reader.readtext(raw_rgb, detail=0, paragraph=False)
        )
        engines["easy_raw"].seconds += time.perf_counter() - start
        start = time.perf_counter()
        texts["easy_pre"] = " ".join(
            reader.readtext(pre_rgb, detail=0, paragraph=False)
        )
        engines["easy_pre"].seconds += time.perf_counter() - start
        start = time.perf_counter()
        texts["tess_pre"] = tesseract_text(pre_rgb, args.tesseract)
        engines["tess_pre"].seconds += time.perf_counter() - start

        hits = {}
        for name, text in texts.items():
            hit, _miss = score_tokens(text, strs, ints)
            hits[name] = hit
            engines[name].add(stype, len(hit), total)

        easy_only = hits["easy_pre"] - hits["tess_pre"]
        tess_only = hits["tess_pre"] - hits["easy_pre"]
        if easy_only:
            wins.append(f"- `{image.name}` ({stype}): {', '.join(sorted(easy_only))}")
        if tess_only:
            losses.append(f"- `{image.name}` ({stype}): {', '.join(sorted(tess_only))}")

        print(
            f"[{idx}/{len(pairs)}] {image.name} ({stype}, {total} tok): "
            f"easy_raw {len(hits['easy_raw'])} easy_pre {len(hits['easy_pre'])} "
            f"tess_pre {len(hits['tess_pre'])}",
            file=sys.stderr,
        )

    report = render_markdown(len(pairs), engines, seen_types, wins, losses)
    print(report)
    if args.md:
        Path(args.md).write_text(report)
        print(f"\nwrote {args.md}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
