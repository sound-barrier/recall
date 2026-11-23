package parser_test

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/draw"
	"image/png"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"

	"recall/pkg/parser"
)

// ──────────────────────────────────────────────────────────────────────────
// The OCR engine evaluation behind .github/workflows/winocr-eval.yml: could
// another engine (Windows.Media.Ocr) read the crops the parser already cuts?
//
// Dump parses the corpus with the real Tesseract and records every OCR call:
// the preprocessed crop Tesseract saw, the raw source crop behind it, the
// call's spec, and what Tesseract read. Other engines read the same crops
// elsewhere (scripts/ci/winocr-eval.ps1 on a Windows runner) and leave their
// readings beside Tesseract's. Replay feeds each engine's readings back
// through the full parse and scores it against the goldens. Replaying
// Tesseract's own readings must reproduce the dump's own parse of every
// screenshot, or the harness is not measuring the parse it claims to.
//
// Layout under $RECALL_OCR_EVAL_DIR:
//
//	manifest.json                      every screenshot and its calls
//	crops/{pre,raw}/<image>/<key>.png  what each call read, and its source rect
//	text/<engine>/<image>/<key>.txt    what each engine read from it
//	timings/<engine>.tsv               image, key, ms, error (one crop a row)
//	versions/<engine>.txt              the engine build that read
//	report.json, report.md             Replay's scores
// ──────────────────────────────────────────────────────────────────────────

const (
	evalDirEnv = "RECALL_OCR_EVAL_DIR"
	// baselineEngine is the dump's own reading, the one every other engine
	// is compared against.
	baselineEngine = "tesseract"
)

type evalManifest struct {
	Generation int         `json:"generation"`
	Tesseract  string      `json:"tesseract"`
	Images     []evalImage `json:"images"`
}

type evalImage struct {
	Image string                `json:"image"`
	Type  parser.ScreenshotType `json:"type"`
	Error string                `json:"error,omitempty"`
	Calls []evalCall            `json:"calls"`
	// Snapshot is the live parse's golden-shaped result (or its error), what
	// replaying Tesseract's own readings must reproduce byte for byte.
	Snapshot json.RawMessage `json:"snapshot"`
}

// evalCall is one OCR invocation. Key is the region name and its occurrence
// within the parse: several calls share a region name (the per-card SR digit
// passes, a retried read), and the work dir's <region>.png keeps only the
// last of them, so the dump cannot be read back from the work dir.
type evalCall struct {
	Key       string `json:"key"`
	Region    string `json:"region"`
	PSM       string `json:"psm"`
	Whitelist string `json:"whitelist"`
	Rect      [4]int `json:"rect"`
	Error     string `json:"error,omitempty"`
	// Timeout marks an Error that was Tesseract's timeout, which the retry
	// ladder does not retry, so the replay must fail the call the same way.
	Timeout bool `json:"timeout,omitempty"`
}

func TestOCREval_Dump(t *testing.T) {
	dir := os.Getenv(evalDirEnv)
	if dir == "" {
		t.Skip("set " + evalDirEnv + " to dump the corpus's OCR crops for the engine evaluation")
	}
	out, err := exec.CommandContext(t.Context(), parser.GetTesseractPath(), "--version").Output()
	if err != nil {
		t.Fatalf("the dump records what a real Tesseract reads, and %q did not run: %v", parser.GetTesseractPath(), err)
	}
	version, _, _ := strings.Cut(string(out), "\n")
	imageDir, _ := fixtureDirs()
	dumpCorpus(t, dir, imageDir, fixtureImages(t, imageDir), strings.TrimSpace(version))
}

func TestOCREval_Replay(t *testing.T) {
	dir := os.Getenv(evalDirEnv)
	if dir == "" {
		t.Skip("set " + evalDirEnv + " to a dumped corpus to score each engine's readings")
	}
	imageDir, goldenDir := fixtureDirs()
	rep := replayCorpus(t, dir, imageDir, goldenDir)
	writeEvalReport(t, dir, rep)
	if rep.ImagesScored == 0 {
		t.Fatal("no dumped screenshot has a golden, so nothing was scored")
	}
	if problem := baselineReplayProblem(rep); problem != "" {
		t.Error(problem)
	}
}

// baselineReplayProblem says why replaying Tesseract's own readings did not
// reproduce the dump's parse, or "" when it did. It is held to the dump, not
// to the goldens: a Tesseract build that reads a screenshot differently from
// the goldens is drift the golden lane reports, and the field scores show it.
func baselineReplayProblem(rep evalReport) string {
	if rep.ImagesDumped == 0 || len(rep.Engines) == 0 {
		return "the dump recorded no screenshots"
	}
	base := rep.Engines[0]
	if base.ImagesMatchingDump == rep.ImagesDumped && base.UnansweredCalls == 0 && base.EngineReadFailures == 0 {
		return ""
	}
	return fmt.Sprintf("replaying Tesseract's own readings reproduced the dumped parse of %d of %d screenshots, with %d calls unanswered and %d recorded calls unread, so the replay is not the parse; diverged: %v",
		base.ImagesMatchingDump, rep.ImagesDumped, base.UnansweredCalls, base.EngineReadFailures, base.DivergedImages)
}

// ── Dump ──────────────────────────────────────────────────────────────────

func dumpCorpus(t *testing.T, dir, imageDir string, images []string, tesseractVersion string) evalManifest {
	t.Helper()
	m := evalManifest{Generation: parser.Generation, Tesseract: tesseractVersion}
	for _, name := range images {
		m.Images = append(m.Images, dumpImage(t, dir, imageDir, name))
	}
	writeEvalJSON(t, filepath.Join(dir, "manifest.json"), m)
	return m
}

// dumpImage parses one screenshot with the OCR seam wrapped, so every call
// the parse makes is recorded on its way to the engine that answers it, and
// keeps the parse's own result for the replay to be held to.
func dumpImage(t *testing.T, dir, imageDir, name string) evalImage {
	t.Helper()
	source := decodeEvalImage(t, filepath.Join(imageDir, name))
	rec := &dumpRecorder{
		t: t, dir: dir, image: name, source: source,
		inner: *parser.RunTesseractFunc, keys: callCounter{}, texts: map[string]string{},
	}
	*parser.RunTesseractFunc = rec.run
	defer func() { *parser.RunTesseractFunc = rec.inner }()

	work := t.TempDir()
	res, err := parser.ParseImage(source, work)
	assertRecordedWhatTheWorkDirKept(t, work, rec)
	img := evalImage{Image: name, Type: parser.TypeUnknown, Calls: rec.calls, Snapshot: parseSnapshot(t, res, err)}
	if err != nil {
		img.Error = err.Error()
	} else {
		img.Type = parser.Classify(res)
	}
	return img
}

// parseSnapshot is a parse's golden-shaped result, or its error, as JSON.
func parseSnapshot(t *testing.T, res *parser.MatchResult, err error) json.RawMessage {
	t.Helper()
	var v any = map[string]string{"error": fmt.Sprint(err)}
	if err == nil {
		v = goldenSnapshot{ScreenshotType: parser.Classify(res), Result: parser.ToGolden(res)}
	}
	b, merr := json.Marshal(v)
	if merr != nil {
		t.Fatalf("marshal snapshot: %v", merr)
	}
	return b
}

type dumpRecorder struct {
	t      *testing.T
	dir    string
	image  string
	source image.Image
	inner  func(image.Image, parser.OCRSpec) (string, error)
	keys   callCounter
	calls  []evalCall
	texts  map[string]string
}

func (r *dumpRecorder) run(pre image.Image, spec parser.OCRSpec) (string, error) {
	text, err := r.inner(pre, spec)
	rect := parser.SpecRect(spec)
	call := evalCall{
		Key:       r.keys.next(parser.SpecName(spec)),
		Region:    parser.SpecName(spec),
		PSM:       parser.SpecPSM(spec),
		Whitelist: parser.SpecWhitelist(spec),
		Rect:      [4]int{rect.Min.X, rect.Min.Y, rect.Max.X, rect.Max.Y},
	}
	writeEvalPNG(r.t, cropPath(r.dir, "pre", r.image, call.Key), pre)
	if raw := rect.Intersect(r.source.Bounds()); !raw.Empty() {
		writeEvalPNG(r.t, cropPath(r.dir, "raw", r.image, call.Key), cutRaw(r.source, raw))
	}
	if err != nil {
		call.Error = err.Error()
		call.Timeout = errors.Is(err, parser.ErrTesseractTimeout)
	} else {
		r.texts[call.Key] = text
		writeEvalFile(r.t, textPath(r.dir, baselineEngine, r.image, call.Key), []byte(text))
	}
	r.calls = append(r.calls, call)
	return text, err
}

// assertRecordedWhatTheWorkDirKept checks the recorder saw what the parse's
// work dir kept (the <region>.txt a diagnosis bundles): each region's reading
// there is its LAST call's, since a later call under the same name
// overwrites the file.
func assertRecordedWhatTheWorkDirKept(t *testing.T, work string, rec *dumpRecorder) {
	t.Helper()
	last := map[string]evalCall{}
	for _, call := range rec.calls {
		last[call.Region] = call
	}
	for region, call := range last {
		kept, ok := readCallText(filepath.Join(work, region+".txt"))
		if ok && call.Error == "" && kept != rec.texts[call.Key] {
			t.Errorf("%s: %s recorded %q, but the work dir kept %q", rec.image, call.Key, rec.texts[call.Key], kept)
		}
	}
}

// callCounter mints call keys: the region name and how many calls under that
// name came before. The parse is sequential, so a replay that takes the same
// path mints the same keys.
type callCounter map[string]int

func (c callCounter) next(region string) string {
	n := c[region]
	c[region] = n + 1
	return region + "." + strconv.Itoa(n)
}

func cutRaw(src image.Image, rect image.Rectangle) image.Image {
	dst := image.NewRGBA(image.Rect(0, 0, rect.Dx(), rect.Dy()))
	draw.Draw(dst, dst.Bounds(), src, rect.Min, draw.Src)
	return dst
}

// ── Replay ────────────────────────────────────────────────────────────────

func replayCorpus(t *testing.T, dir, imageDir, goldenDir string) evalReport {
	t.Helper()
	var m evalManifest
	readEvalJSON(t, filepath.Join(dir, "manifest.json"), &m)
	goldens := goldensOf(t, m.Images, goldenDir)
	rep := evalReport{
		Generation:          m.Generation,
		Versions:            engineVersions(t, dir, m.Tesseract),
		ImagesDumped:        len(m.Images),
		ImagesScored:        len(goldens),
		ImagesWithoutGolden: len(m.Images) - len(goldens),
	}
	for _, engine := range evalEngines(t, dir) {
		rep.Engines = append(rep.Engines, scoreEngine(t, evalSource{dir, imageDir}, engine, m.Images, goldens))
	}
	return rep
}

// goldensOf reads each dumped screenshot's golden as leaves, keyed by image;
// a screenshot without one is replayed but not scored against a golden.
func goldensOf(t *testing.T, images []evalImage, goldenDir string) map[string]map[string]string {
	t.Helper()
	out := map[string]map[string]string{}
	for _, img := range images {
		b, err := os.ReadFile(filepath.Join(goldenDir, img.Image+".golden.json"))
		if errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if err != nil {
			t.Fatalf("read golden for %s: %v", img.Image, err)
		}
		out[img.Image] = jsonLeaves(t, b)
	}
	return out
}

// evalEngines lists the engines that left readings, the baseline first.
func evalEngines(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(filepath.Join(dir, "text"))
	if err != nil {
		t.Fatalf("list engine readings: %v", err)
	}
	var others []string
	for _, e := range entries {
		if e.IsDir() && e.Name() != baselineEngine {
			others = append(others, e.Name())
		}
	}
	if !slices.ContainsFunc(entries, func(e fs.DirEntry) bool { return e.Name() == baselineEngine }) {
		t.Fatalf("no %s readings under %s: run the dump first", baselineEngine, dir)
	}
	slices.Sort(others)
	return append([]string{baselineEngine}, others...)
}

// evalSource is where a replay reads from: the evaluation dir and the
// screenshots the dump parsed.
type evalSource struct{ dir, imageDir string }

func scoreEngine(t *testing.T, src evalSource, engine string, images []evalImage, goldens map[string]map[string]string) engineReport {
	t.Helper()
	rep := engineReport{Engine: engine}
	for _, img := range images {
		out := replayImage(t, src, engine, img)
		rep.UnansweredCalls += out.unanswered
		rep.EngineReadFailures += out.unread
		if sameJSON(out.snapshot, img.Snapshot) {
			rep.ImagesMatchingDump++
		} else {
			rep.DivergedImages = append(rep.DivergedImages, img.Image)
		}
		if golden, ok := goldens[img.Image]; ok {
			rep.scoreAgainstGolden(img.Image, golden, jsonLeaves(t, out.snapshot))
		}
	}
	rep.FieldAccuracy = ratio(rep.FieldsMatched, rep.FieldsTotal)
	if engine != baselineEngine {
		rep.Regions, rep.ByRegion = agreementWithBaseline(src.dir, engine, images)
	}
	rep.Timing = readTimings(t, filepath.Join(src.dir, "timings", engine+".tsv"))
	return rep
}

func (e *engineReport) scoreAgainstGolden(imageName string, golden, leaves map[string]string) {
	matched := countMatching(golden, leaves)
	e.FieldsMatched += matched
	e.FieldsTotal += len(golden)
	if matched == len(golden) && len(leaves) == len(golden) {
		e.ImagesExact++
	} else {
		e.MismatchedImages = append(e.MismatchedImages, imageName)
	}
}

// sameJSON compares two JSON documents byte for byte once compacted: the
// manifest stores a snapshot re-indented, which changes only whitespace.
func sameJSON(a, b []byte) bool {
	var ca, cb bytes.Buffer
	if json.Compact(&ca, a) != nil || json.Compact(&cb, b) != nil {
		return false
	}
	return bytes.Equal(ca.Bytes(), cb.Bytes())
}

type replayOutcome struct {
	snapshot   json.RawMessage
	unanswered int
	unread     int
}

// replayImage parses one screenshot with every OCR call answered from the
// engine's recorded readings, and returns the parse's snapshot.
func replayImage(t *testing.T, src evalSource, engine string, img evalImage) replayOutcome {
	t.Helper()
	r := newReplayer(src.dir, engine, img)
	saved := *parser.RunTesseractFunc
	*parser.RunTesseractFunc = r.run
	defer func() { *parser.RunTesseractFunc = saved }()

	res, err := parser.ParseImage(decodeEvalImage(t, filepath.Join(src.imageDir, img.Image)), t.TempDir())
	return replayOutcome{snapshot: parseSnapshot(t, res, err), unanswered: r.unanswered, unread: r.unread}
}

type replayer struct {
	dir, engine string
	image       string
	keys        callCounter
	dumped      map[string]evalCall
	// unanswered counts calls the dump never made: the replayed parse took
	// another path. unread counts calls the dump made that this engine left
	// no reading for: the engine failed on the crop.
	unanswered, unread int
}

func newReplayer(dir, engine string, img evalImage) *replayer {
	dumped := map[string]evalCall{}
	for _, call := range img.Calls {
		dumped[call.Key] = call
	}
	return &replayer{dir: dir, engine: engine, image: img.Image, keys: callCounter{}, dumped: dumped}
}

// run answers a call from the engine's reading of the same key. A call the
// dump saw fail fails again for every engine, before any reading of its crop
// is looked at, so the retry ladder walks the same keys the dump did.
func (r *replayer) run(_ image.Image, spec parser.OCRSpec) (string, error) {
	key := r.keys.next(parser.SpecName(spec))
	call, ok := r.dumped[key]
	switch {
	case !ok:
		r.unanswered++
		return "", nil
	case call.Timeout:
		return "", fmt.Errorf("%w (replayed: %s)", parser.ErrTesseractTimeout, call.Error)
	case call.Error != "":
		return "", errors.New(call.Error)
	}
	text, ok := readCallText(textPath(r.dir, r.engine, r.image, key))
	if !ok {
		r.unread++
		return "", nil
	}
	fitted, _ := fitToWhitelist(r.engine, text, parser.SpecWhitelist(spec))
	return fitted, nil
}

// ── Files ─────────────────────────────────────────────────────────────────

func cropPath(dir, kind, imageName, key string) string {
	return filepath.Join(dir, "crops", kind, imageName, key+".png")
}

func textPath(dir, engine, imageName, key string) string {
	return filepath.Join(dir, "text", engine, imageName, key+".txt")
}

func readCallText(path string) (string, bool) {
	b, err := os.ReadFile(path)
	return string(b), err == nil
}

func readEvalText(t *testing.T, dir, engine, imageName, key string) string {
	t.Helper()
	text, ok := readCallText(textPath(dir, engine, imageName, key))
	if !ok {
		t.Fatalf("no %s reading for %s %s", engine, imageName, key)
	}
	return text
}

func decodeEvalImage(t *testing.T, path string) image.Image {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()
	img, _, err := image.Decode(f)
	if err != nil {
		t.Fatalf("decode %s: %v", path, err)
	}
	return img
}

func writeEvalFile(t *testing.T, path string, b []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, b, 0o600); err != nil {
		t.Fatal(err)
	}
}

func writeEvalPNG(t *testing.T, path string, img image.Image) {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatalf("encode %s: %v", path, err)
	}
	writeEvalFile(t, path, b.Bytes())
}
