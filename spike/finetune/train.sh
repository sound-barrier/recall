#!/usr/bin/env bash
#
# Fine-tune Tesseract's English LSTM on the real OW-rendered number crops that
# label.py produced, then report char-error-rate (CER) before vs after on a
# held-out split. All inputs AND the trained model are local + gitignored; only
# the scripts + the FINETUNE-SPIKE.md writeup are committed (the model rebuilds
# from setup.sh -> label.py -> train.sh).
#
# Usage:  ITER=400 spike/finetune/train.sh
set -euo pipefail

readonly DATA="spike/finetune/data"
readonly WORK="spike/finetune/train"
readonly HELPER="spike/finetune/.tesstrain/generate_line_box.py"
readonly PY="spike/finetune/.venv/bin/python"
# Local tessdata: the float tessdata_best eng model (fine-tunable, unlike the
# system's fast integer model) paired with the lstm.train config. Both fetched
# by spike/finetune/setup.sh; gitignored.
readonly TESSDATA="spike/finetune/tessdata"
readonly ITER="${ITER:-400}"

mkdir -p "${WORK}"

# 1. One box + lstmf per crop (the box gives the line text; lstmf is the
#    training packet tesseract consumes).
echo "[1/5] generating lstmf training packets ..."
local_count=0
for png in "${DATA}"/*.png; do
  base="${png%.png}"
  "${PY}" "${HELPER}" -i "${png}" -t "${base}.gt.txt" >"${base}.box"
  tesseract "${png}" "${base}" -l eng --tessdata-dir "${TESSDATA}" --psm 7 \
    lstm.train >/dev/null 2>&1
  local_count=$((local_count + 1))
done
echo "      ${local_count} packets"

# 2. BY-IMAGE split: hold out ~12% of source IMAGES (all their crops go to eval)
#    so no screenshot contributes to both train and eval. A by-crop split leaks
#    intra-image font/resolution and inflates the held-out CER.
printf '%s\n' "${DATA}"/*.lstmf >"${WORK}/all.list"
sed 's#.*/##; s#_[0-9]*\.lstmf$##' "${WORK}/all.list" | sort -u \
  | awk 'BEGIN { srand(42) } { print rand() "\t" $0 }' | sort | cut -f2 \
  >"${WORK}/images.shuf"
nimg="$(wc -l <"${WORK}/images.shuf")"
neval_img=$((nimg / 8))
head -n "${neval_img}" "${WORK}/images.shuf" >"${WORK}/images.eval"
awk -v evalf="${WORK}/list.eval" -v trainf="${WORK}/list.train" '
  NR == FNR { ev[$0] = 1; next }
  {
    key = $0
    sub(/.*\//, "", key)
    sub(/_[0-9]+\.lstmf$/, "", key)
    print >(key in ev ? evalf : trainf)
  }
' "${WORK}/images.eval" "${WORK}/all.list"
ntrain="$(wc -l <"${WORK}/list.train")"
neval="$(wc -l <"${WORK}/list.eval")"
echo "[2/5] by-image split: ${ntrain} train / ${neval} eval crops" \
  "(${neval_img}/${nimg} images held out)"

# 3. Extract the base English float LSTM to continue training from.
echo "[3/5] extracting base eng.lstm ..."
combine_tessdata -e "${TESSDATA}/eng.traineddata" "${WORK}/eng.lstm" >/dev/null

# 4. Fine-tune (continue from eng; unicharset unchanged — GT is digits only).
echo "[4/5] fine-tuning ${ITER} iterations ..."
lstmtraining \
  --model_output "${WORK}/ow" \
  --continue_from "${WORK}/eng.lstm" \
  --traineddata "${TESSDATA}/eng.traineddata" \
  --train_listfile "${WORK}/list.train" \
  --eval_listfile "${WORK}/list.eval" \
  --max_iterations "${ITER}" 2>&1 | tail -5
lstmtraining \
  --stop_training \
  --continue_from "${WORK}/ow_checkpoint" \
  --traineddata "${TESSDATA}/eng.traineddata" \
  --model_output "${WORK}/ow.traineddata" >/dev/null 2>&1

# 5. CER before vs after on the held-out split.
echo "[5/5] evaluating on held-out split ..."
echo "--- BASE (eng) ---"
lstmeval --model "${TESSDATA}/eng.traineddata" \
  --eval_listfile "${WORK}/list.eval" 2>&1 | grep -iE 'BCER eval|BWER eval' || true
echo "--- TUNED (ow) ---"
lstmeval --model "${WORK}/ow.traineddata" \
  --eval_listfile "${WORK}/list.eval" 2>&1 | grep -iE 'BCER eval|BWER eval' || true
echo "done. fine-tuned model: ${WORK}/ow.traineddata"
