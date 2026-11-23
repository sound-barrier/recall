# Windows OCR spike — Windows.Media.Ocr vs Tesseract

An outside review of the README suggested Recall read its screenshots with
**Windows.Media.Ocr** (WMO), the OCR engine built into Windows, instead of
shelling out to Tesseract. The appeal is real: the engine ships with the OS,
so the "install Tesseract first" step would go away, and it runs in-process,
so no process is spawned per crop. This spike measures whether WMO can read
the crops the parser already cuts, end to end against the human-verified
goldens. It ran in CI on PR #828 (run
[45132339278](https://github.com/sound-barrier/recall/actions/runs/45132339278),
commit `fff46a81`); the lane stays in the tree as
`.github/workflows/winocr-eval.yml`.

## Verdict

**Do not adopt Windows.Media.Ocr now.** Fed the parser's own crops, it got 5
of 97 golden screenshots exactly right and 56–58% of their fields, against
Tesseract's 97 of 97 and 100%; four of those five are career-history and
all-heroes screens whose goldens hold a single marker. The misses are not
spread evenly. WMO matches Tesseract on clean multi-digit cells (TEAMS damage
and healing, 15 of 16) and reads the SUMMARY performance cards' text nearly as
well (60 of 84), but it agrees with Tesseract on almost none of the one- and
two-digit TEAMS E/A/D cells (1 of 24), the digits-only passes (SUMMARY totals 0
of 84, rank SR digits 0 of 18), the stylized rank-screen text (banner, badge and
tier 1 of 141, modifier chips 0 of 45, SR panel 0 of 50) or the screen-type probes (18
of 261). WMO is 3–12× faster per crop, but a parse already runs in the
background after the match, and speed does not buy back a field that reads
wrong. The install-step problem the review raised is real, and it has a
cheaper answer that keeps today's accuracy: **ship Tesseract inside the
installer** ([`BUNDLE-TESS-SPIKE.md`](BUNDLE-TESS-SPIKE.md)), which is the
recommended follow-up.

## Data

97 golden screenshots (45 rank, 28 SUMMARY, 12 PERSONAL, 8 TEAMS, 3 career
history, 1 all-heroes), 1,553 golden fields, 1,318 recorded OCR calls. Parser
generation 3.

### Headline, as the lane reported it

| Engine | Screenshots exact | Field accuracy | Matches dump | Regions exact vs Tesseract | CER vs Tesseract | Unread crops | Whitelist edits | Read failures | Unanswered calls | Median ms/crop | p90 ms/crop | Crops timed | Timing errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| tesseract | 97/97 | 100.0% | 97/97 | n/a | n/a | n/a | n/a | 0 | 0 | n/a | n/a | n/a | n/a |
| tesseract-win | 97/97 | 100.0% | 97/97 | 1318/1318 | 0.0% | 0 | 0 | 0 | 0 | 187.8 | 270.7 | 1318 | 0 |
| wmo-pre | 5/97 | 56.0% | 5/97 | 215/1318 | 44.2% | 0 | 2783 | 0 | 309 | 53.8 | 123.1 | 1318 | 0 |
| wmo-raw | 5/97 | 58.3% | 5/97 | 233/1318 | 46.7% | 0 | 2721 | 0 | 269 | 16.0 | 30.9 | 1318 | 0 |

- **tesseract** is the Linux dump's own reading, replayed. It must reproduce the
  dump's parse of every screenshot byte for byte, or the harness is not
  measuring the parse; it did (97/97, nothing unanswered).
- **tesseract-win** is the pinned Windows build reading the same preprocessed
  crops, with each call's PSM and whitelist, on the Windows runner. It agreed
  with the Linux build on every crop, so the timings compare like for like.
- **wmo-pre** is Windows OCR on the preprocessed crop Tesseract saw (inverted,
  upscaled, thresholded per the call). **wmo-raw** is Windows OCR on the
  untouched source rectangle behind it.
- **Screenshots exact** means every golden field matched. **Field accuracy**
  is matched golden fields over all 1,553. **CER** is character edit distance
  over Tesseract's characters; it passes 100% when WMO returns more text than
  Tesseract did. Region agreement and CER measure disagreement with Tesseract,
  not error, but Tesseract's readings reproduce every golden, so on this
  corpus a disagreement on a crop the parse kept is very likely a wrong reading.

### Agreement with Tesseract by region family

The lane reports 69 regions; this rolls them up by what they read. Every
region's `tesseract-win` column was exact, so it is left out.

| Screen | What the crop reads | Regions | Crops | wmo-pre exact | wmo-pre CER | wmo-raw exact | wmo-raw CER |
|---|---|---|---|---|---|---|---|
| TEAMS | damage and healing cells (`col_dmg_bin`, `col_h_bin`) | 2 | 16 | 15/16 | 1.2% | 14/16 | 2.4% |
| TEAMS | mitigation cell (`col_mit`, `col_mit_bin`) | 2 | 12 | 5/12 | 50.0% | 8/12 | 18.2% |
| TEAMS | E/A/D cells (`col_e_bin`, `col_a_bin`, `col_d_bin`) | 3 | 24 | 1/24 | 94.6% | 6/24 | 67.6% |
| TEAMS | queue row count (`q_blue`, `q_red`) | 2 | 16 | 4/16 | 5.4% | 6/16 | 4.2% |
| SUMMARY | performance card, plain pass (`summary_perf_*`) | 3 | 84 | 60/84 | 1.7% | 63/84 | 2.4% |
| SUMMARY | performance total, digits-only pass (`summary_perf_*_total`) | 3 | 84 | 0/84 | 128.0% | 0/84 | 127.4% |
| SUMMARY | match card and heroes played (`summary_card`, `summary_heroes`) | 2 | 56 | 0/56 | 43.7% | 1/56 | 42.3% |
| PERSONAL | 3×3 stat grid, all passes (`personal_r*c*`) | 26 | 312 | 35/312 | 18.8% | 32/312 | 24.7% |
| PERSONAL | hero sidebar (`personal_sidebar`) | 1 | 12 | 10/12 | 1.9% | 10/12 | 0.6% |
| RANK | banner, badge and tier (`rank_banner*`, `rank_badge`, `rank_tier*`) | 7 | 141 | 1/141 | 70.2% | 1/141 | 69.1% |
| RANK | modifier chips (`rank_modifiers`) | 1 | 45 | 0/45 | 51.2% | 0/45 | 58.0% |
| RANK | change pill (`rank_change*`) | 4 | 136 | 59/136 | 62.7% | 67/136 | 56.9% |
| RANK | progress and percentile (`rank_progress*`, `rank_percentile_occluded`) | 3 | 51 | 7/51 | 84.5% | 7/51 | 80.1% |
| RANK | SR panel text (`rank_sr`, `rank_sr_occluded`) | 2 | 50 | 0/50 | 26.6% | 0/50 | 32.6% |
| RANK | SR digits-only passes (`rank_sr_digits_3`, `rank_sr_digits_6`) | 2 | 18 | 0/18 | 229.2% | 0/18 | 238.5% |
| All | screen-type probes (`detect_*`) | 6 | 261 | 18/261 | 63.4% | 18/261 | 66.6% |

## What the numbers mean

1. **WMO reads clean, multi-digit numbers well.** TEAMS damage and healing
   cells (multi-digit values) agree 15 of 16, and the PERSONAL hero
   sidebar 10 of 12. Where a crop holds one line of ordinary text or a long
   number, the engine is competitive.
2. **Short numbers are where it breaks.** The same TEAMS row's E/A/D cells,
   one or two digits each, agree 1 of 24 on the preprocessed crop and 6 of 24
   on the raw one. These are the stats every rollup reads first.
3. **The digits-only passes fail by design, not by legibility.** The SUMMARY
   plain pass and digits-only pass read the *same* crop. WMO agrees with
   Tesseract on the plain pass 60 of 84 times and on the digits-only pass 0 of
   84. That pass relies on Tesseract's whitelist forcing a crop that also holds
   the label and the per-10-minute line down to digits, with the total on the
   first line; WMO returns the whole card, and fitting its words to a digit
   whitelist turns them into a run of digits (hence CER above 100%). The rank
   SR digit passes fail the same way. A WMO parser would take the total from
   the plain reading instead, so these rows say more about the parser's design
   than about WMO.
4. **The stylized rank screen is the hard case, and it is not a pass-design
   artifact.** The banner, tier and modifier crops carry no whitelist at all,
   and WMO still agrees on 1 of 185. The SR panel text agrees 0 of 50. The
   rank screen is 45 of the 97 goldens.
5. **The probes and the path divergence compound it.** A probe is read for a
   keyword, not exact text, so 18 of 261 overstates the damage of each single
   miss. But 92 of 97 replayed parses diverged from Tesseract's, and 309
   (pre) / 269 (raw) OCR calls went down paths the dump never took. The report
   does not say how many of those began with a wrong screen type.
6. **Raw crops help WMO, slightly.** wmo-raw beats wmo-pre on field accuracy
   (58.3% vs 56.0%) and region agreement (233 vs 215), most visibly on TEAMS
   E/A/D and mitigation, which suggests the Tesseract-shaped preprocessing
   (inversion, 3× upscale, hard thresholds) costs WMO something. It is not
   enough to change the verdict.

## Fairness caveats

The comparison is honest about what it measures, and what it measures leans
toward Tesseract:

- **Every region, preprocessing step and pass was tuned for Tesseract.** The
  crop boxes, the invert-and-upscale default, the thresholds, the dual-PSM SR
  backfill, the plain-plus-digits pairing on SUMMARY cards and the per-region
  PSM were each chosen because Tesseract read them right. WMO was handed crops
  cut for another engine.
- **WMO has no PSM and no whitelist.** The `OcrEngine` API takes a language and
  an image, nothing else. Its readings were fitted to each region's Tesseract
  whitelist after the fact, the way Tesseract would force them (other case,
  then the usual letter-to-digit confusions, then drop), and that fitting
  edited about 2.7k characters. A real integration would have to do the same
  or parse WMO's free text differently.
- **The replay understates WMO where paths diverge.** When WMO's reading sends
  the parse down another path, the replay answers the new calls with empty
  text, because the dump has no crop for them. A live WMO parse would have
  read those crops. The divergence itself comes from WMO's own misreads, so
  this softens the field-accuracy number, not the conclusion.
- **A WMO-native parser is a different parser, and its cost is unmeasured.**
  It would need its own region boxes (WMO returns word bounding boxes, which
  could replace some fixed crops), its own preprocessing or none, plain-text
  parsing in place of every digits-only pass, a new answer for one- and
  two-digit cells (upscaling, padding, or leaning on the `pkg/glyphs` digit
  templates that now cross-check those cells), re-tuned probe keywords, and a
  re-baselined golden corpus. Qualitatively that is a rewrite of the OCR
  extraction layer across all four screen types. It also moves the golden
  lane to Windows runners, since WMO does not exist on Linux or macOS, and
  takes parsing away from the macOS dev flow. No part of that was built or
  timed here.

## Speed

Times are per crop, file to text, on the same `windows-2025` runner:

| Engine | Median ms/crop | p90 ms/crop | Total for 1,318 crops | Per screenshot (mean) |
|---|---|---|---|---|
| tesseract-win | 187.8 | 270.7 | 274.3 s | 2.8 s |
| wmo-pre | 53.8 | 123.1 | 90.8 s | 0.9 s |
| wmo-raw | 16.0 | 30.9 | 24.6 s | 0.25 s |

WMO is 3.5× (preprocessed) to 11.7× (raw) faster at the median. Tesseract's
time includes spawning a process and loading its model on every crop, which
is how production runs it (`pkg/tesseract` shells out per call); WMO's
excludes creating the engine, which happens once. The raw crops are also
smaller than the upscaled ones, which accounts for part of wmo-raw's lead.
Nothing in the product waits on this interactively: a parse runs in the
background after the match.

## Method

Three jobs plus a lint, all in `.github/workflows/winocr-eval.yml`:

1. **crops** (ubuntu-24.04). `TestOCREval_Dump` (`pkg/parser/ocr_eval_test.go`)
   parses every golden screenshot through `parser.ParseImage` with the
   `RunTesseractFunc` seam wrapped, so each OCR call is recorded on its way to
   the real Tesseract: the preprocessed crop, the raw source rectangle behind
   it, the region name, PSM, whitelist and rectangle, Tesseract's reading, and
   the parse's own golden-shaped result. A check holds the recording to what
   the parse's work dir kept.
2. **winocr** (pinned `windows-2025`, never `windows-latest`, because the OCR
   engine is part of the OS image). `scripts/ci/winocr-eval.ps1`, under Windows
   PowerShell 5.1 for the WinRT projection PowerShell 7 dropped, reads every
   recorded call three ways: WMO on the preprocessed crop, WMO on the raw crop
   (either scaled down first when past `OcrEngine.MaxImageDimension`), and a
   pinned, hash-verified UB-Mannheim Tesseract build on the preprocessed crop
   with the call's PSM and whitelist. Each read is timed with a `Stopwatch`.
3. **compare** (ubuntu-24.04). `TestOCREval_Replay` re-parses every screenshot
   with each OCR call answered from an engine's recorded reading (fitted to the
   whitelist, see `ocr_eval_whitelist_test.go`) and scores the result against
   the goldens, against Tesseract crop by crop, and on time. It fails the job
   if Tesseract's own replay does not reproduce the dump.

PSScriptAnalyzer (pinned, hash-verified) lints the PowerShell before a Windows
runner is spent on it.

### Versions

| Component | Version |
|---|---|
| Windows | 10.0.26100.0 (`windows-2025` runner image) |
| Windows.Media.Ocr | en-US recognizer (`Language.OCR~~~en-US~0.0.1.0`, already installed on the image) |
| Tesseract, Windows leg | 5.5.3.20260724 (UB-Mannheim build attached to the upstream 5.5.3 release) |
| Tesseract, Linux dump | 5.5.1 (alex-p PPA, via `scripts/ci/install-tesseract.sh`) |
| Golden baseline | Tesseract 5.5.x (`TESSERACT_VERSION` in `mise.toml`) |

## Recommendation

1. **Keep Tesseract.** It reads this corpus perfectly through a parser built
   around it, and nothing measured here suggests a second engine would read it
   better.
2. **Solve the install step by bundling Tesseract** in the Windows installer,
   as [`BUNDLE-TESS-SPIKE.md`](BUNDLE-TESS-SPIKE.md) lays out: copy
   `tesseract.exe`, its DLLs and stock `eng.traineddata` beside the app and
   prefer that path over a system install. Same parser, same goldens, no new
   engine to tune.
3. **Keep the lane.** It costs nothing until dispatched, and it is the
   instrument for the revisit conditions below.

### What would have to be true to revisit

- **A WMO-native parse beats or ties Tesseract on the goldens.** That means a
  prototype with its own crops, preprocessing and plain-text parsing for at
  least the rank and SUMMARY screens, scored with this lane's replay, not a
  better number on Tesseract's crops.
- **Short numbers read reliably,** for example through WMO plus the
  `pkg/glyphs` digit templates, measured on the TEAMS E/A/D cells.
- **The golden lane can run where WMO runs.** Every parser change would have to
  be gated on a Windows runner, and the macOS dev flow would need a fallback
  engine.
- **Bundling Tesseract turns out to be blocked** (size, signing, antivirus false
  positives on the bundled binary), so the install step can only be removed by
  using what Windows already ships.

## Claims not verified

- That every Windows install a player uses has the en-US recognizer. The
  runner image did; the workflow installs the capability when it is missing,
  and a player's machine depends on its installed language features.
- How much of the 309 / 269 unanswered calls a live WMO parse would have read
  right. The replay cannot know, because the dump has no crops for them.
- The scope of a WMO-native parser. It is reasoned from the region list above,
  not built.

## Reproduce

Dispatch the lane (it also runs on any PR that touches its own files):

```sh
gh workflow run winocr-eval.yml --ref <branch>
gh run download <run-id> -n ocr-eval-report   # report.md + report.json
```

The run uploads three artifacts: `ocr-eval-dump` (crops, manifest and
Tesseract's readings, kept 7 days), `ocr-eval-windows` (the Windows readings,
timings and versions, 7 days) and `ocr-eval-report` (30 days). To re-score
locally, download the first two into one directory and run the replay with the
fixture submodule checked out (`task fetch-fixtures`):

```sh
RECALL_OCR_EVAL_DIR="$PWD/tmp/ocr-eval" go test -count=1 -run '^TestOCREval_Replay$' ./pkg/parser/
```

## Sources

- Lane run on PR #828:
  <https://github.com/sound-barrier/recall/actions/runs/45132339278>
- Microsoft Learn — `Windows.Media.Ocr.OcrEngine`:
  <https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr.ocrengine>
- Microsoft Learn — `OcrEngine.MaxImageDimension`:
  <https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr.ocrengine.maximagedimension>
- Harness: `pkg/parser/ocr_eval_test.go`, `ocr_eval_report_test.go`,
  `ocr_eval_whitelist_test.go`, `scripts/ci/winocr-eval.ps1`,
  `.github/workflows/winocr-eval.yml`
- [`BUNDLE-TESS-SPIKE.md`](BUNDLE-TESS-SPIKE.md),
  [`OCR-ENGINE-SPIKE.md`](OCR-ENGINE-SPIKE.md) (EasyOCR, the earlier engine
  comparison, which also found the preprocessing tuned to Tesseract)
