package parser_test

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"maps"
	"math"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
	"unicode/utf8"
)

// Scoring for the OCR engine evaluation (ocr_eval_test.go): how close each
// engine's replayed parse came to the goldens, how often it read a region as
// Tesseract did, and how long it took per crop. report.json is the
// machine-readable copy the evaluation write-up is built from; report.md is
// the same numbers for the workflow's step summary.

type evalReport struct {
	Generation          int               `json:"generation"`
	Versions            map[string]string `json:"versions"`
	ImagesDumped        int               `json:"images_dumped"`
	ImagesScored        int               `json:"images_scored"`
	ImagesWithoutGolden int               `json:"images_without_golden"`
	Engines             []engineReport    `json:"engines"`
}

type engineReport struct {
	Engine        string  `json:"engine"`
	ImagesExact   int     `json:"images_exact"`
	FieldsMatched int     `json:"fields_matched"`
	FieldsTotal   int     `json:"fields_total"`
	FieldAccuracy float64 `json:"field_accuracy"`
	// ImagesMatchingDump counts screenshots, golden or not, whose replayed
	// parse is byte-equal to the dump's own; DivergedImages names the rest.
	ImagesMatchingDump int      `json:"images_matching_dump"`
	DivergedImages     []string `json:"diverged_images,omitempty"`
	// UnansweredCalls counts OCR calls the replayed parse made that the dump
	// never recorded: the engine's readings sent the parse down another path,
	// and those calls read nothing.
	UnansweredCalls int `json:"unanswered_calls"`
	// EngineReadFailures counts calls the dump recorded that the replayed
	// parse made but this engine left no reading for: it failed on the crop,
	// and the call read nothing.
	EngineReadFailures int                         `json:"engine_read_failures"`
	MismatchedImages   []string                    `json:"mismatched_images,omitempty"`
	Regions            *regionAgreement            `json:"regions_vs_tesseract,omitempty"`
	ByRegion           map[string]*regionAgreement `json:"by_region,omitempty"`
	Timing             *timingSummary              `json:"timing,omitempty"`
}

// regionAgreement is how an engine's readings compare with Tesseract's on the
// same crops. Tesseract is the reference, not the truth: a CER here is
// disagreement, and the golden scores say which engine was right.
//
// Unread counts crops Tesseract read that this engine left no reading for;
// they are not compared. WhitelistEdits counts the characters fitting the
// engine's readings to each region's whitelist changed or dropped.
type regionAgreement struct {
	Compared       int     `json:"compared"`
	Unread         int     `json:"unread"`
	WhitelistEdits int     `json:"whitelist_edits"`
	Exact          int     `json:"exact"`
	EditDistance   int     `json:"edit_distance"`
	ReferenceChars int     `json:"reference_chars"`
	CER            float64 `json:"cer"`
}

type timingSummary struct {
	Crops    int     `json:"crops"`
	Errors   int     `json:"errors"`
	MedianMS float64 `json:"median_ms"`
	P90MS    float64 `json:"p90_ms"`
	TotalMS  float64 `json:"total_ms"`
}

// The harness itself, run on a stubbed seam: a dump records every OCR call of
// a parse, replaying the dump's own readings reproduces the golden, and an
// engine that misreads the region that decided the parse is scored down on
// the golden and on agreement with Tesseract, and timed from what it reported.
func TestOCREval_ScoresAReplayedEngineAgainstTheGoldens(t *testing.T) {
	stubOCR(t, map[string]string{"detect_history": "AQ RESETS EVERY PATCH"})
	shot := writePNG(t, tinyImage())
	imageDir, name := filepath.Dir(shot), filepath.Base(shot)
	dir := t.TempDir()
	writeEvalFile(t, filepath.Join(imageDir, name+".golden.json"),
		[]byte(`{"screenshot_type": "history", "result": {"history": true}}`))

	calls := dumpCorpus(t, dir, imageDir, []string{name}, "stub").Images[0].Calls
	for _, call := range calls {
		text := readEvalText(t, dir, baselineEngine, name, call.Key)
		if call.Region == "detect_history" {
			text = "nothing here"
		}
		writeEvalFile(t, textPath(dir, "wmo-pre", name, call.Key), []byte(text))
	}
	writeEvalFile(t, filepath.Join(dir, "timings", "wmo-pre.tsv"),
		[]byte("shot.png\tdetect_rank.0\t4\t\nshot.png\tdetect_history.0\t9\t\nshot.png\tdetect_summary.0\t\tboom\n"))

	rep := replayCorpus(t, dir, imageDir, imageDir)

	if rep.ImagesScored != 1 || len(rep.Engines) != 2 {
		t.Fatalf("scored %d images over %d engines, want 1 over 2", rep.ImagesScored, len(rep.Engines))
	}
	assertEngineScore(t, rep.Engines[0], engineScore{baselineEngine, 1, 2, 2, 0})
	assertEngineScore(t, rep.Engines[1], engineScore{"wmo-pre", 0, 0, 2, 0})
	wmo := rep.Engines[1]
	if got := wmo.Regions; got == nil || got.Exact != len(calls)-1 || got.CER <= 0 {
		t.Errorf("wmo-pre agreement = %+v, want all %d regions but one read as Tesseract did", got, len(calls))
	}
	if got, want := wmo.Timing, (timingSummary{Crops: 2, Errors: 1, MedianMS: 6.5, P90MS: 9, TotalMS: 13}); got == nil || *got != want {
		t.Errorf("wmo-pre timing = %+v, want %+v", got, want)
	}
	assertReportNamesEachEngine(t, dir, rep)
}

type engineScore struct {
	engine                                       string
	imagesExact, fieldsMatched, fieldsTotal, gap int
}

func assertEngineScore(t *testing.T, e engineReport, want engineScore) {
	t.Helper()
	if got := (engineScore{e.Engine, e.ImagesExact, e.FieldsMatched, e.FieldsTotal, e.UnansweredCalls}); got != want {
		t.Errorf("score = %+v, want %+v (engine, exact images, fields matched, fields, unanswered)", got, want)
	}
}

func assertReportNamesEachEngine(t *testing.T, dir string, rep evalReport) {
	t.Helper()
	writeEvalReport(t, dir, rep)
	md, err := os.ReadFile(filepath.Join(dir, "report.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range rep.Engines {
		if !strings.Contains(string(md), "| "+e.Engine+" |") {
			t.Errorf("report.md has no row for %s:\n%s", e.Engine, md)
		}
	}
}

// ── Golden fields ─────────────────────────────────────────────────────────

// jsonLeaves flattens a golden-shaped document to its scalar fields keyed by
// path, so a replay is scored field by field rather than all or nothing.
func jsonLeaves(t *testing.T, b []byte) map[string]string {
	t.Helper()
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatalf("unmarshal golden-shaped JSON: %v", err)
	}
	out := map[string]string{}
	flattenJSON("", v, out)
	return out
}

func flattenJSON(path string, v any, out map[string]string) {
	switch x := v.(type) {
	case map[string]any:
		if len(x) == 0 {
			out[path] = "{}"
		}
		for k, child := range x {
			flattenJSON(path+"/"+k, child, out)
		}
	case []any:
		if len(x) == 0 {
			out[path] = "[]"
		}
		for i, child := range x {
			flattenJSON(path+"/"+strconv.Itoa(i), child, out)
		}
	default:
		b, _ := json.Marshal(x) // a decoded JSON scalar always re-encodes
		out[path] = string(b)
	}
}

func countMatching(golden, got map[string]string) int {
	n := 0
	for path, want := range golden {
		if v, ok := got[path]; ok && v == want {
			n++
		}
	}
	return n
}

func ratio(n, d int) float64 { return float64(n) / float64(max(d, 1)) }

// ── Agreement with Tesseract ──────────────────────────────────────────────

func agreementWithBaseline(dir, engine string, images []evalImage) (*regionAgreement, map[string]*regionAgreement) {
	total, byRegion := &regionAgreement{}, map[string]*regionAgreement{}
	for _, img := range images {
		for _, call := range img.Calls {
			ref, okRef := readCallText(textPath(dir, baselineEngine, img.Image, call.Key))
			if !okRef {
				continue
			}
			if byRegion[call.Region] == nil {
				byRegion[call.Region] = &regionAgreement{}
			}
			got, okGot := readCallText(textPath(dir, engine, img.Image, call.Key))
			for _, a := range []*regionAgreement{total, byRegion[call.Region]} {
				a.addReading(engine, ref, got, okGot, call.Whitelist)
			}
		}
	}
	return total, byRegion
}

// addReading counts one crop Tesseract read: unread when the engine left no
// reading, else compared once fitted to the region's whitelist, as the
// replay fits it.
func (a *regionAgreement) addReading(engine, ref, got string, read bool, whitelist string) {
	if !read {
		a.Unread++
		return
	}
	fitted, edits := fitToWhitelist(engine, got, whitelist)
	a.WhitelistEdits += edits
	a.add(ref, fitted)
}

// add counts one region: exact when the readings agree line for line, with the
// edit distance between them, in characters, toward the character error rate.
func (a *regionAgreement) add(ref, got string) {
	ref, got = normalizeReading(ref), normalizeReading(got)
	a.Compared++
	if ref == got {
		a.Exact++
	}
	a.EditDistance += runeLevenshtein([]rune(ref), []rune(got))
	a.ReferenceChars += utf8.RuneCountInString(ref)
	a.CER = ratio(a.EditDistance, a.ReferenceChars)
}

// runeLevenshtein is the edit distance in characters. parser.Levenshtein
// counts bytes, and the roster the parser reads prints Lúcio and Torbjörn.
func runeLevenshtein(a, b []rune) int {
	prev := make([]int, len(b)+1)
	for j := range prev {
		prev[j] = j
	}
	for i := range a {
		cur := make([]int, len(b)+1)
		cur[0] = i + 1
		for j := range b {
			cost := 1
			if a[i] == b[j] {
				cost = 0
			}
			cur[j+1] = min(prev[j+1]+1, cur[j]+1, prev[j]+cost)
		}
		prev = cur
	}
	return prev[len(b)]
}

// normalizeReading keeps a reading's non-blank lines, trimmed: engines differ
// in trailing whitespace and blank lines, which no parser rule reads.
func normalizeReading(s string) string {
	var lines []string
	for line := range strings.Lines(s) {
		if line = strings.TrimSpace(line); line != "" {
			lines = append(lines, line)
		}
	}
	return strings.Join(lines, "\n")
}

// ── Timings ───────────────────────────────────────────────────────────────

// readTimings summarizes an engine's per-crop timings, written by the engine's
// runner as tab-separated image, key, milliseconds, error; a row with an error
// has no time. No file means the engine was not timed.
func readTimings(t *testing.T, path string) *timingSummary {
	t.Helper()
	b, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		t.Fatalf("read timings: %v", err)
	}
	var ms []float64
	failed := 0
	for line := range strings.Lines(string(b)) {
		fields := strings.Split(strings.TrimRight(line, "\r\n"), "\t")
		switch {
		case len(fields) != 4:
			continue
		case fields[3] != "":
			failed++
		default:
			v, err := strconv.ParseFloat(fields[2], 64)
			if err != nil {
				t.Fatalf("%s: timing %q: %v", path, line, err)
			}
			ms = append(ms, v)
		}
	}
	return summarizeTimings(ms, failed)
}

func summarizeTimings(ms []float64, failed int) *timingSummary {
	s := &timingSummary{Crops: len(ms), Errors: failed}
	if len(ms) == 0 {
		return s
	}
	slices.Sort(ms)
	mid := len(ms) / 2
	s.MedianMS = ms[mid]
	if len(ms)%2 == 0 {
		s.MedianMS = (ms[mid-1] + ms[mid]) / 2
	}
	s.P90MS = ms[int(math.Ceil(0.9*float64(len(ms))))-1]
	for _, v := range ms {
		s.TotalMS += v
	}
	return s
}

// engineVersions reads the build each engine's runner reported, beside the
// Tesseract version the dump recorded.
func engineVersions(t *testing.T, dir, tesseractVersion string) map[string]string {
	t.Helper()
	versions := map[string]string{baselineEngine: tesseractVersion}
	files, err := filepath.Glob(filepath.Join(dir, "versions", "*.txt"))
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range files {
		text, _ := readCallText(f)
		versions[strings.TrimSuffix(filepath.Base(f), ".txt")] = strings.TrimSpace(text)
	}
	return versions
}

// ── Report ────────────────────────────────────────────────────────────────

func writeEvalReport(t *testing.T, dir string, rep evalReport) {
	t.Helper()
	writeEvalJSON(t, filepath.Join(dir, "report.json"), rep)
	writeEvalFile(t, filepath.Join(dir, "report.md"), []byte(renderEvalReport(rep)))
}

const evalReportNotes = `
Screenshots exact and field accuracy score the replayed parse against the
goldens; matches dump counts screenshots whose replayed parse is byte-equal to
the dump's own, which Tesseract's replay must reach for every screenshot.
Region agreement and CER (in characters) compare each engine's reading of a
crop with Tesseract's: disagreement, not error, since Tesseract is the
reference rather than the truth. Windows OCR takes no whitelist, so its
readings are fitted to each region's Tesseract whitelist before replay and
comparison: a character outside it becomes its other case or its usual
letter/digit confusion (O to 0, l to 1, S to 5, B to 8, and back) when that is
allowed, as Tesseract would force it, and is dropped only when nothing is;
whitelist edits counts the characters that step changed or dropped. Unread
crops are crops Tesseract read that the engine left no reading for, and read
failures the same among the calls a replay made; they read nothing.
Unanswered calls are OCR calls the replayed parse made that the dump never
recorded, because the engine's readings sent it down another path; they read
nothing too. Times are per crop, file to text, on the same Windows runner.
`

func renderEvalReport(rep evalReport) string {
	var b strings.Builder
	fmt.Fprintf(&b, "## OCR engine evaluation\n\nParser generation %d; %d screenshots dumped, %d scored against their goldens (%d without one).\n\n",
		rep.Generation, rep.ImagesDumped, rep.ImagesScored, rep.ImagesWithoutGolden)
	for _, engine := range slices.Sorted(maps.Keys(rep.Versions)) {
		fmt.Fprintf(&b, "- %s: %s\n", engine, rep.Versions[engine])
	}
	b.WriteString("\n| Engine | Screenshots exact | Field accuracy | Matches dump | Regions exact vs Tesseract | CER vs Tesseract | Unread crops | Whitelist edits | Read failures | Unanswered calls | Median ms/crop | p90 ms/crop | Crops timed | Timing errors |\n")
	b.WriteString("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n")
	for _, e := range rep.Engines {
		b.WriteString(engineRow(e, rep.ImagesScored, rep.ImagesDumped))
	}
	b.WriteString(evalReportNotes)
	b.WriteString(regionTable(rep.Engines))
	return b.String()
}

func engineRow(e engineReport, scored, dumped int) string {
	agreement := "n/a | n/a | n/a | n/a"
	if a := e.Regions; a != nil {
		agreement = fmt.Sprintf("%d/%d | %s | %d | %d", a.Exact, a.Compared, percent(a.CER), a.Unread, a.WhitelistEdits)
	}
	timing := "n/a | n/a | n/a | n/a"
	if e.Timing != nil {
		timing = fmt.Sprintf("%.1f | %.1f | %d | %d", e.Timing.MedianMS, e.Timing.P90MS, e.Timing.Crops, e.Timing.Errors)
	}
	return fmt.Sprintf("| %s | %d/%d | %s | %d/%d | %s | %d | %d | %s |\n",
		e.Engine, e.ImagesExact, scored, percent(e.FieldAccuracy), e.ImagesMatchingDump, dumped,
		agreement, e.EngineReadFailures, e.UnansweredCalls, timing)
}

// regionTable breaks agreement with Tesseract down by region, one column pair
// per compared engine.
func regionTable(engines []engineReport) string {
	compared := slices.DeleteFunc(slices.Clone(engines), func(e engineReport) bool { return e.ByRegion == nil })
	if len(compared) == 0 {
		return ""
	}
	regions := map[string]bool{}
	var b strings.Builder
	b.WriteString("\n### Agreement with Tesseract by region\n\n| Region |")
	for _, e := range compared {
		fmt.Fprintf(&b, " %s exact | %s CER |", e.Engine, e.Engine)
		for region := range e.ByRegion {
			regions[region] = true
		}
	}
	b.WriteString("\n|---|" + strings.Repeat("---|---|", len(compared)) + "\n")
	for _, region := range slices.Sorted(maps.Keys(regions)) {
		b.WriteString("| " + region + " |")
		for _, e := range compared {
			b.WriteString(regionCells(e.ByRegion[region]))
		}
		b.WriteString("\n")
	}
	return b.String()
}

func regionCells(a *regionAgreement) string {
	if a == nil {
		return " n/a | n/a |"
	}
	return fmt.Sprintf(" %d/%d | %s |", a.Exact, a.Compared, percent(a.CER))
}

func percent(x float64) string { return fmt.Sprintf("%.1f%%", 100*x) }

func writeEvalJSON(t *testing.T, path string, v any) {
	t.Helper()
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		t.Fatalf("marshal %s: %v", path, err)
	}
	writeEvalFile(t, path, append(b, '\n'))
}

func readEvalJSON(t *testing.T, path string, v any) {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	if err := json.Unmarshal(b, v); err != nil {
		t.Fatalf("decode %s: %v", path, err)
	}
}
