package parser

import (
	"os"
	"path/filepath"
	"strings"
)

// ProbeStep is one rung of the probe ladder as a diagnosis saw it. The TEAMS
// fall-through appears as a final "teams" step when every probe declined.
type ProbeStep struct {
	Name    string `json:"name"`
	Matched bool   `json:"matched"`
	Error   string `json:"error,omitempty"`
}

// Diagnosis is one screenshot re-parsed with every intermediate kept, for a
// diagnostic bundle: the probe ladder, the outcome under THIS build (which
// says whether a ledgered failure is already fixed), what each region read,
// and every crop and reading from the work dir.
type Diagnosis struct {
	Type   ScreenshotType
	Error  string
	Probes []ProbeStep
	// OCR maps each region name to the text Tesseract read from it.
	OCR map[string]string
	// Files holds every work file by basename: <region>.png is the
	// preprocessed crop Tesseract saw, <region>.txt what it read.
	Files map[string][]byte
}

// Diagnose re-parses one screenshot in a private work dir — never
// RECALL_DEBUG_DIR, and never left on disk. A failure at any stage is
// reported in Error rather than returned: a diagnosis of a broken file is
// still a diagnosis.
func Diagnose(imagePath string) Diagnosis {
	d := Diagnosis{Type: TypeUnknown}
	img, err := decodeImage(imagePath)
	if err != nil {
		d.Error = err.Error()
		return d
	}
	work, err := os.MkdirTemp("", "recall-diagnose-*")
	if err != nil {
		d.Error = err.Error()
		return d
	}
	defer func() { _ = os.RemoveAll(work) }()

	res, err := parseImageTraced(img, work, &d.Probes)
	if err != nil {
		d.Error = err.Error()
	} else {
		d.Type = Classify(res)
	}
	d.Files, d.OCR = readWorkFiles(work)
	return d
}

func recordProbe(trace *[]ProbeStep, name string, matched bool, err error) {
	if trace == nil {
		return
	}
	step := ProbeStep{Name: name, Matched: matched}
	if err != nil {
		step.Error = err.Error()
	}
	*trace = append(*trace, step)
}

// readWorkFiles collects the work dir's crops and readings. Unreadable
// entries are skipped: the diagnosis reports what it can.
func readWorkFiles(work string) (files map[string][]byte, ocr map[string]string) {
	files, ocr = map[string][]byte{}, map[string]string{}
	entries, err := os.ReadDir(work)
	if err != nil {
		return files, ocr
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		// #nosec G304 -- a basename listed from our own MkdirTemp dir.
		b, err := os.ReadFile(filepath.Join(work, e.Name()))
		if err != nil {
			continue
		}
		files[e.Name()] = b
		if region, ok := strings.CutSuffix(e.Name(), ".txt"); ok {
			ocr[region] = string(b)
		}
	}
	return files, ocr
}
