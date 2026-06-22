# Bundle Tesseract — "download and it just works"

Today Recall makes users **separately install Tesseract** (brew / UB-Mannheim /
apt) and then locate it in Settings — the #1 onboarding friction. This spike
proves the app can instead **ship a self-contained Tesseract**, so the user
downloads one thing and it works. No accuracy change, no parser rewrite, no CGo.

## Verdict

**Bundle stock Tesseract — it's the cheapest path to a self-contained app, and the
smallest.** A relocatable macOS bundle is **13 MB** (vs ~44 MB for in-process
PP-OCR), keeps the entire hand-tuned parser unchanged, and runs with zero system
dependencies. The only code change is a few lines so the app prefers the bundled
binary over a system one.

## Result (macOS / arm64)

`spike/bundle-tess/bundle.sh` produces a fully relocated bundle:

| | |
|---|---|
| Self-contained | **zero `/opt/homebrew` references** (verified via `otool -L` on the binary + all 15 dylibs) — only `@loader_path` + system `/usr/lib` + `/System` |
| Runs standalone | `tesseract --version` works off the bundled dylibs; OCRs a real crop correctly using only the bundled `eng.traineddata` |
| Size | **13 MB** — binary 88 KB + dylibs 8.6 MB + `eng.traineddata` 4.1 MB |

## Which `traineddata` to ship — stock `eng`, NOT a fine-tune

Ship **stock `eng.traineddata`**. The fine-tune spike (`FINETUNE-SPIKE.md`, #498)
showed a custom-trained model is **worse end-to-end** (79% vs **100%**) — base
`eng` + the parser's invert/upscale preprocessing + digit whitelist already reads
OW numbers at 100%, so a "trained" model only regresses it.

- **Don't add a fine-tune task target** — it drags in RapidOCR + the Tesseract
  training tools and produces a worse model.
- **Don't commit the `.traineddata`** — it's a stable upstream asset; **fetch it at
  build time** (CI already installs tesseract, so `bundle.sh` just copies it).
  You'd only commit a `.traineddata` if you were shipping a genuinely-better
  *custom* model, which the data says you're not.

## Method (the macOS gotchas)

1. Copy the `tesseract` binary; `dylibbundler` recursively copies its non-system
   dylib closure (libtesseract, leptonica, libarchive, + the image/compression
   libs) and rewrites every install-name to `@loader_path/../libs`.
2. **Ad-hoc re-sign** every relocated dylib + the binary (`codesign --force
   --sign -`). On Apple Silicon, `install_name_tool` invalidates a dylib's code
   signature and the loader will refuse it (`killed: 9`) until it's re-signed.
3. Copy stock `eng.traineddata` (+ `configs/`) into `tessdata/`.

## Wiring it into the app (the only code change)

`pkg/app/tesseract.go::defaultTesseractPath()` already probes a list of paths.
Prepend a **bundled** path resolved relative to the running executable, e.g.:

- macOS: `<Recall.app>/Contents/Resources/tesseract/bin/tesseract` with
  `TESSDATA_PREFIX=<…>/Resources/tesseract/tessdata`.
- Windows/Linux: `<dir-of-exe>/tesseract/bin/tesseract` + the sibling `tessdata`.

Prefer the bundled binary; fall back to the existing system-path probe (so a
user-installed Tesseract still works, and the dev flow is unchanged). The
"Locate Tesseract" UI stays as the manual override. ~5–10 lines.

## Cross-platform

- **macOS (done here):** `dylibbundler` + ad-hoc sign. The app isn't notarized
  today (manual Gatekeeper), so ad-hoc signing is consistent; **if/when the `.app`
  is notarized**, sign the bundled binary + dylibs with the Developer ID and
  notarize the whole bundle.
- **Windows:** copy `tesseract.exe` + its DLLs + `tessdata` into the install dir
  (the NSIS installer already lays files down). No signature-relocation problem
  (PE doesn't break on path changes). Similar size.
- **Linux:** either bundle `tesseract` + its `.so` closure with
  `patchelf --set-rpath '$ORIGIN/../libs'`, **or** simpler — make the `.deb`
  `Depends: tesseract-ocr` so `apt` pulls it automatically (already
  "download and it works" for the deb). The `.tar.gz` would bundle.

## vs in-process PP-OCR (Tier A, #500)

| | Bundle Tesseract | In-process PP-OCR |
|---|---|---|
| Parser changes | none | rewrite the OCR-extraction layer |
| CGo in the Go app | no | yes |
| Size / OS | **~13 MB** | ~44 MB |
| Accuracy | same as today | ≈ tie (#499) |

Bundling Tesseract wins on every axis that matters here.

## Recommended follow-ups

1. Wire `defaultTesseractPath()` to prefer the bundled path (the ~10-line change).
2. Add a **`task bundle-tess`** target wrapping `bundle.sh` (mac), with the
   Windows/Linux equivalents, and hook it into `release.yml` so each artifact
   carries its bundle.
3. Update the install docs — drop the "install Tesseract first" step.

## Reproduce

```sh
brew install dylibbundler      # one-time
bash spike/bundle-tess/bundle.sh
```

The bundle (`spike/bundle-tess/bundle/`) is gitignored — only `bundle.sh` + this
writeup are committed. `eng.traineddata` is fetched from the build machine's
tesseract, never committed.
