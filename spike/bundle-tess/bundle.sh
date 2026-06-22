#!/usr/bin/env bash
#
# Prototype: build a relocatable, self-contained Tesseract bundle so Recall can
# SHIP OCR instead of making users install it ("download and it works"). Copies
# the tesseract binary + its full non-system dylib closure, rewrites them to
# @loader_path (dylibbundler), ad-hoc re-signs (Apple Silicon invalidates a
# signature after install_name_tool edits it), and bundles STOCK eng.traineddata.
#
# It ships stock eng on purpose: the fine-tune spike (FINETUNE-SPIKE.md) showed a
# custom-trained model is WORSE end-to-end, because base eng + the parser's
# preprocessing + digit whitelist already reads OW numbers at 100%.
#
# eng.traineddata is FETCHED from the build machine's tesseract (CI already
# installs it) — not committed. Output (gitignored): spike/bundle-tess/bundle/.
# macOS/arm64; Windows/Linux equivalents are in BUNDLE-TESS-SPIKE.md.
set -euo pipefail
cd "$(dirname "$0")/../.." # repo root
readonly OUT="spike/bundle-tess/bundle"
TBIN="$(command -v tesseract)"
TESSDATA_SRC="$(dirname "$(find /opt/homebrew /usr/local /usr/share -name eng.traineddata 2>/dev/null | head -1)")"
readonly TBIN TESSDATA_SRC

command -v dylibbundler >/dev/null || {
  echo "need dylibbundler — brew install dylibbundler" >&2
  exit 1
}

echo "[1/4] copy tesseract + relocate its dylib closure to @loader_path/../libs"
rm -rf "${OUT}"
mkdir -p "${OUT}/bin" "${OUT}/libs" "${OUT}/tessdata"
cp "${TBIN}" "${OUT}/bin/tesseract"
yes | dylibbundler -od -b -x "${OUT}/bin/tesseract" -d "${OUT}/libs" \
  -p '@loader_path/../libs' >/dev/null 2>&1 || true

echo "[2/4] ad-hoc re-sign (arm64 needs valid signatures after relocation)"
find "${OUT}" -type f \( -name '*.dylib' -o -name tesseract \) \
  -exec codesign --force --sign - {} \; 2>/dev/null

echo "[3/4] bundle stock eng.traineddata (fetched, not committed)"
cp "${TESSDATA_SRC}/eng.traineddata" "${OUT}/tessdata/"
[ -d "${TESSDATA_SRC}/configs" ] && cp -R "${TESSDATA_SRC}/configs" "${OUT}/tessdata/"

echo "[4/4] verify self-contained + run"
if otool -L "${OUT}/bin/tesseract" "${OUT}/libs/"*.dylib | grep -q /opt/homebrew; then
  echo "  FAIL: still references /opt/homebrew" >&2
  otool -L "${OUT}/bin/tesseract" "${OUT}/libs/"*.dylib | grep /opt/homebrew >&2
  exit 1
fi
echo "  no /opt/homebrew references — fully relocated"
TESSDATA_PREFIX="${PWD}/${OUT}/tessdata" "${OUT}/bin/tesseract" --version | head -1
echo "  bundle size: $(du -sh "${OUT}" | cut -f1)"
echo "done. Point the app at ${OUT}/bin/tesseract with TESSDATA_PREFIX=${OUT}/tessdata."
