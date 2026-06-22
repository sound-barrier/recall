#!/usr/bin/env bash
#
# One-time local setup for the Tesseract fine-tune spike. Everything this
# creates is gitignored — local training tooling, never committed. Only the
# scripts (setup.sh, label.py, train.sh) and the FINETUNE-SPIKE.md writeup are
# tracked; the trained model rebuilds from these.
#
# Prereqs already on the box: tesseract + its training tools (lstmtraining,
# combine_tessdata, lstmeval, text2image) and python3.
set -euo pipefail
cd "$(dirname "$0")/../.." # repo root
readonly ROOT="spike/finetune"

# 1. Local venv with RapidOCR — the auto-labeler's *detector* (ONNX, no PyTorch).
echo "[1/3] python venv + rapidocr ..."
python3 -m venv "${ROOT}/.venv"
"${ROOT}/.venv/bin/python" -m pip install --quiet --upgrade pip
"${ROOT}/.venv/bin/pip" install --quiet rapidocr-onnxruntime Pillow numpy

# 2. tesstrain's per-line box generator (one helper file).
echo "[2/3] box helper ..."
mkdir -p "${ROOT}/.tesstrain"
curl -fsSL \
  https://raw.githubusercontent.com/tesseract-ocr/tesstrain/main/generate_line_box.py \
  -o "${ROOT}/.tesstrain/generate_line_box.py"

# 3. Float (fine-tunable) eng model + the lstm.train config. The system tesseract
#    ships only the FAST integer model, which lstmtraining refuses to continue
#    from ("is an integer (fast) model, cannot continue training").
echo "[3/3] tessdata_best eng (float) + lstm.train config ..."
mkdir -p "${ROOT}/tessdata/configs"
curl -fsSL \
  https://github.com/tesseract-ocr/tessdata_best/raw/main/eng.traineddata \
  -o "${ROOT}/tessdata/eng.traineddata"
config="$(find /opt/homebrew /usr -path '*tessdata/configs/lstm.train' 2>/dev/null | head -1)"
if [[ -n "${config}" ]]; then
  cp "${config}" "${ROOT}/tessdata/configs/"
else
  echo "WARN: lstm.train config not found; locate it in your tesseract's tessdata/configs/" >&2
fi

echo "setup complete. Run label.py (see its header) to build the crop set, then train.sh."
