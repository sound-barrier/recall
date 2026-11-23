package glyphs_test

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/draw"
	_ "image/jpeg" // the corpus holds a few JPG captures
	"image/png"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strconv"
	"testing"

	"gopkg.in/yaml.v3"

	"recall/pkg/glyphs"
)

// refsDir is the embedded reference tree; manifest.yaml inside it is the
// human-written record of where every reference cut comes from.
const refsDir = "refs"

// refEntry is one manifest row. Label and Rect are transcribed by a person
// looking at the source screenshot's pixels, never taken from parser output,
// so a reference cannot inherit the misreads it exists to catch.
type refEntry struct {
	Kind   string `yaml:"kind"`   // digit
	Label  string `yaml:"label"`  // the digit, 0 to 9
	Screen string `yaml:"screen"` // summary | teams | rank
	Source string `yaml:"source"` // fixture filename in the recall-testdata corpus
	Rect   []int  `yaml:"rect"`   // x, y, width, height in source pixels
}

func (e refEntry) rect() image.Rectangle {
	return image.Rect(e.Rect[0], e.Rect[1], e.Rect[0]+e.Rect[2], e.Rect[1]+e.Rect[3])
}

// refScreens are the screens a digit is cut from, each with its own font
// size and weight.
var refScreens = []string{"summary", "teams", "rank"}

func (e refEntry) validate() error {
	if !slices.Contains(refScreens, e.Screen) {
		return fmt.Errorf("screen %q is not summary, teams or rank", e.Screen)
	}
	if len(e.Rect) != 4 || e.Rect[2] <= 0 || e.Rect[3] <= 0 {
		return fmt.Errorf("rect %v is not [x, y, width, height]", e.Rect)
	}
	if e.Source == "" {
		return errors.New("names no source screenshot")
	}
	return e.validateLabel()
}

func (e refEntry) validateLabel() error {
	if e.Kind != "digit" {
		return fmt.Errorf("kind %q is not digit", e.Kind)
	}
	if len(e.Label) != 1 || e.Label[0] < '0' || e.Label[0] > '9' {
		return fmt.Errorf("digit label %q is not 0 to 9", e.Label)
	}
	return nil
}

// refPaths is where each entry's cut lives under refs/: digit/<d>/<screen>.png,
// with -2, -3, ... on repeat cuts of one label from one screen, numbered in
// manifest order.
func refPaths(entries []refEntry) []string {
	seen := map[string]int{}
	paths := make([]string, len(entries))
	for i, e := range entries {
		base := path.Join("digit", e.Label, e.Screen)
		seen[base]++
		if n := seen[base]; n > 1 {
			base += "-" + strconv.Itoa(n)
		}
		paths[i] = base + ".png"
	}
	return paths
}

func loadManifest(t *testing.T) []refEntry {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(refsDir, "manifest.yaml"))
	if err != nil {
		t.Fatalf("read manifest: %v", err)
	}
	var entries []refEntry
	if err := yaml.Unmarshal(data, &entries); err != nil {
		t.Fatalf("parse manifest: %v", err)
	}
	for i, e := range entries {
		if err := e.validate(); err != nil {
			t.Fatalf("manifest entry %d (%s %s from %s): %v", i, e.Kind, e.Label, e.Source, err)
		}
	}
	return entries
}

func committedCuts(t *testing.T) []string {
	t.Helper()
	var found []string
	err := fs.WalkDir(os.DirFS(refsDir), ".", func(name string, entry fs.DirEntry, err error) error {
		if err == nil && !entry.IsDir() && path.Ext(name) == ".png" {
			found = append(found, name)
		}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return found
}

func TestManifest_NamesEveryCommittedReference(t *testing.T) {
	want := refPaths(loadManifest(t))
	got := committedCuts(t)
	slices.Sort(want)
	if !slices.Equal(got, want) {
		t.Fatalf("refs/ holds %v\nmanifest.yaml names %v\nrun `task cut-references` to recut", got, want)
	}
}

func TestManifest_CoversEveryDigit(t *testing.T) {
	covered := map[string]bool{}
	for _, e := range loadManifest(t) {
		covered[e.Label] = true
	}
	for d := range 10 {
		if !covered[strconv.Itoa(d)] {
			t.Errorf("no reference cut for digit %d: ReadNumber could never read it", d)
		}
	}
}

// TestEmbeddedReferences_ReadEachCutAsItsLabel reads every committed cut back
// through the package readers. Its own reference scores 1, so a failure means
// another label's reference looks just as much like it: a mislabeled cut.
func TestEmbeddedReferences_ReadEachCutAsItsLabel(t *testing.T) {
	entries := loadManifest(t)
	for i, name := range refPaths(entries) {
		e := entries[i]
		img := decodeRef(t, name)
		got, ok := readCut(img)
		if !ok || got != e.Label {
			t.Errorf("%s (%s): read back as %q (ok=%v), want %s", name, e.Source, got, ok, e.Label)
		}
	}
}

func readCut(img image.Image) (string, bool) {
	got, ok := glyphs.ReadNumber(img, img.Bounds())
	return strconv.Itoa(got.Value), ok
}

func decodeRef(t *testing.T, name string) image.Image {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(refsDir, filepath.FromSlash(name)))
	if err != nil {
		t.Fatal(err)
	}
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	return img
}

// TestReferences_AreCutFromTheirManifestPixels holds every committed cut to a
// fresh cut of its manifest rect, so a reference is always reproducible from
// the corpus. RECALL_REFS_UPDATE=1 rewrites refs/ from the manifest instead.
func TestReferences_AreCutFromTheirManifestPixels(t *testing.T) {
	imageDir := requireFixtureImages(t)
	entries := loadManifest(t)
	update := os.Getenv("RECALL_REFS_UPDATE") != ""
	if update {
		removeCommittedCuts(t)
	}
	for i, name := range refPaths(entries) {
		cut := encodeCut(t, entries[i], imageDir)
		target := filepath.Join(refsDir, filepath.FromSlash(name))
		if update {
			writeCut(t, target, cut)
			continue
		}
		committed, err := os.ReadFile(target)
		if err != nil || !bytes.Equal(committed, cut) {
			t.Errorf("%s is not a fresh cut of %s %v (read err: %v) — run `task cut-references`",
				name, entries[i].Source, entries[i].Rect, err)
		}
	}
}

func encodeCut(t *testing.T, e refEntry, imageDir string) []byte {
	t.Helper()
	src := decodeFixture(t, filepath.Join(imageDir, e.Source))
	if !e.rect().In(src.Bounds()) {
		t.Fatalf("%s %s: rect %v falls outside %s %v", e.Kind, e.Label, e.Rect, e.Source, src.Bounds())
	}
	cut := image.NewNRGBA(image.Rect(0, 0, e.Rect[2], e.Rect[3]))
	draw.Draw(cut, cut.Bounds(), src, e.rect().Min, draw.Src)
	var buf bytes.Buffer
	if err := (&png.Encoder{CompressionLevel: png.BestCompression}).Encode(&buf, cut); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func decodeFixture(t *testing.T, file string) image.Image {
	t.Helper()
	data, err := os.ReadFile(file)
	if err != nil {
		t.Fatalf("manifest source: %v", err)
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("decode %s: %v", file, err)
	}
	return img
}

func writeCut(t *testing.T, target string, cut []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, cut, 0o644); err != nil {
		t.Fatal(err)
	}
}

func removeCommittedCuts(t *testing.T) {
	t.Helper()
	for _, name := range committedCuts(t) {
		if err := os.Remove(filepath.Join(refsDir, filepath.FromSlash(name))); err != nil {
			t.Fatal(err)
		}
	}
}

// fixtureImageDir mirrors the parser golden lane: RECALL_FIXTURE_DIR, else the
// recall-testdata submodule.
func fixtureImageDir() string {
	if dir := os.Getenv("RECALL_FIXTURE_DIR"); dir != "" {
		return dir
	}
	return filepath.Join("..", "..", "testdata", "images")
}

// requireFixtureImages skips when the recall-testdata corpus is not checked
// out, as it is not in ci.yml's -short run; golden-corpus.yml checks it out.
func requireFixtureImages(t *testing.T) string {
	t.Helper()
	dir := fixtureImageDir()
	if entries, err := os.ReadDir(dir); err != nil || len(entries) == 0 {
		t.Skipf("fixture image dir %q missing or empty — run 'task fetch-fixtures'", dir)
	}
	return dir
}

// TestProposeSegmentation is a labeling aid, not a check: with
// RECALL_REFS_PROPOSE=<fixture filename> and RECALL_REFS_REGION=x,y,w,h it
// prints the glyph boxes the matcher would segment in that region, each with
// a suggested manifest rect. The label is still read off the pixels by eye.
func TestProposeSegmentation(t *testing.T) {
	source := os.Getenv("RECALL_REFS_PROPOSE")
	if source == "" {
		t.Skip("labeling aid: set RECALL_REFS_PROPOSE=<fixture> and RECALL_REFS_REGION=x,y,w,h")
	}
	img := decodeFixture(t, filepath.Join(fixtureImageDir(), source))
	region := parseRegion(t, os.Getenv("RECALL_REFS_REGION"), img.Bounds())
	boxes, conclusive := glyphs.Segment(img, region)
	t.Logf("%s %v: %d glyph boxes, conclusive=%v", source, region, len(boxes), conclusive)
	for i, box := range boxes {
		cut := suggestCut(boxes, i, region)
		t.Logf("box %d %v  rect: [%d, %d, %d, %d]", i, box, cut.Min.X, cut.Min.Y, cut.Dx(), cut.Dy())
	}
}

// cutMargin is the background a suggested digit cut keeps around its glyph.
const cutMargin = 3

// suggestCut pads box by cutMargin, stopping halfway to each neighbor so the
// cut holds no ink but its own glyph.
func suggestCut(boxes []image.Rectangle, i int, region image.Rectangle) image.Rectangle {
	cut := boxes[i].Inset(-cutMargin).Intersect(region)
	if i > 0 {
		cut.Min.X = max(cut.Min.X, (boxes[i-1].Max.X+boxes[i].Min.X+1)/2)
	}
	if i < len(boxes)-1 {
		cut.Max.X = min(cut.Max.X, (boxes[i].Max.X+boxes[i+1].Min.X)/2)
	}
	return cut
}

func parseRegion(t *testing.T, spec string, bounds image.Rectangle) image.Rectangle {
	t.Helper()
	if spec == "" {
		return bounds
	}
	var x, y, w, h int
	if _, err := fmt.Sscanf(spec, "%d,%d,%d,%d", &x, &y, &w, &h); err != nil {
		t.Fatalf("RECALL_REFS_REGION %q: want x,y,w,h: %v", spec, err)
	}
	return image.Rect(x, y, x+w, y+h)
}
