package tesseract_test

import (
	"image"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"recall/pkg/tesseract"
)

// The text Tesseract read is kept beside the crop it read, always — not only
// under RECALL_DEBUG_DIR. A diagnostic export re-parses a failed screenshot in
// a work dir and ships what each region read; with the text gated on a
// developer env var, a field bundle could carry the crops but never the
// readings that decided the parse.
func TestRun_KeepsTheReadTextBesideTheCrop(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake tesseract is a shell script")
	}
	t.Setenv("RECALL_DEBUG_DIR", "")
	bin := t.TempDir()
	fake := filepath.Join(bin, "tesseract")
	if err := os.WriteFile(fake, []byte("#!/bin/sh\necho 'RANK PROGRESS: 8%'\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	tesseract.SetPath(fake)
	t.Cleanup(func() { tesseract.SetPath("tesseract") })

	work := t.TempDir()
	if _, err := tesseract.Run(image.NewGray(image.Rect(0, 0, 8, 8)), tesseract.Spec{WorkDir: work, Name: "rank_tier", PSM: "6"}); err != nil {
		t.Fatalf("Run: %v", err)
	}
	got, err := os.ReadFile(filepath.Join(work, "rank_tier.txt"))
	if err != nil {
		t.Fatalf("read text beside the crop: %v", err)
	}
	if !strings.Contains(string(got), "RANK PROGRESS: 8%") {
		t.Errorf("kept text = %q, want what Tesseract printed", got)
	}
}

// `tesseract --list-langs` prints a header line, then one language per line.
// A diagnostic bundle carries the list because an install without "eng"
// reads nothing on every screenshot.
func TestListLanguages_ReadsTheInstalledLanguages(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake tesseract is a shell script")
	}
	bin := t.TempDir()
	fake := filepath.Join(bin, "tesseract")
	script := "#!/bin/sh\nprintf 'List of available languages in \"/usr/share/tessdata/\" (2):\\neng\\nosd\\n'\n"
	if err := os.WriteFile(fake, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	tesseract.SetPath(fake)
	t.Cleanup(func() { tesseract.SetPath("tesseract") })

	langs, err := tesseract.ListLanguages()
	if err != nil {
		t.Fatalf("ListLanguages: %v", err)
	}
	if strings.Join(langs, ",") != "eng,osd" {
		t.Errorf("languages = %v, want [eng osd]", langs)
	}
}
