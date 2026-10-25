package bundle

import (
	"fmt"
	"math"
	"slices"
	"strings"

	"recall/pkg/correlate"
)

// Likely-cause codes. Each names a problem in the user's setup or files that
// produces the same symptom as a parser bug, so the report dialog can offer
// the fix first and the maintainer's triage can tell the two apart.
const (
	CauseTesseractMissing     = "tesseract_missing"
	CauseTesseractUnsupported = "tesseract_unsupported"
	CauseTesseractNoEnglish   = "tesseract_no_english"
	CauseFileMissing          = "file_missing"
	CauseImageUnreadable      = "image_unreadable"
	CauseUnusualAspectRatio   = "unusual_aspect_ratio"
	CauseUnrecognizedFilename = "unrecognized_filename"
)

// LikelyCause is one finding: a stable code, the file it is about (empty for
// an environment finding), and a sentence the user can act on.
type LikelyCause struct {
	Code     string `json:"code"`
	Filename string `json:"filename,omitempty"`
	Message  string `json:"message"`
}

// aspectTolerance is how far from 16:9 a capture may sit before its layout
// shifts: the parser places every region as a fraction of a 16:9 frame.
const aspectTolerance = 0.02

// PreflightDiagnostic reports the likely causes for the picked files without
// building a bundle — what the report dialog shows before the user saves.
func PreflightDiagnostic(in DiagnosticInputs) []LikelyCause {
	facts := make([]fileFacts, 0, len(in.Files))
	for _, f := range in.Files {
		ff, err := readDiagnosticFile(in, f)
		if err != nil {
			// Present but unreadable: the export will refuse it the same way,
			// and the user is better told why now.
			ff.body = []byte{}
		}
		facts = append(facts, ff)
	}
	return likelyCauses(in.Env, facts)
}

func likelyCauses(env DiagnosticEnv, files []fileFacts) []LikelyCause {
	causes := environmentCauses(env)
	for _, f := range files {
		if c, ok := fileCause(f); ok {
			causes = append(causes, c)
		}
	}
	return causes
}

func environmentCauses(env DiagnosticEnv) []LikelyCause {
	causes := make([]LikelyCause, 0, 1)
	if !env.TesseractFound {
		return append(causes, LikelyCause{
			Code:    CauseTesseractMissing,
			Message: "Recall can't find Tesseract, so it can't read any screenshot. Install Tesseract 5, or point Settings → Engine at it.",
		})
	}
	if major, _, _ := strings.Cut(env.TesseractVersion, "."); major != "5" {
		causes = append(causes, LikelyCause{
			Code:    CauseTesseractUnsupported,
			Message: fmt.Sprintf("Tesseract %s is installed. Recall is tuned for 5.x, and older versions misread the Overwatch font. Upgrade to Tesseract 5.", versionOrUnknown(env.TesseractVersion)),
		})
	}
	if len(env.TesseractLanguages) > 0 && !slices.Contains(env.TesseractLanguages, "eng") {
		causes = append(causes, LikelyCause{
			Code:    CauseTesseractNoEnglish,
			Message: "Tesseract has no English language data (eng), so it reads nothing from Overwatch's text. Reinstall Tesseract with English included.",
		})
	}
	return causes
}

// fileCause reports the first problem with one file: each later check
// assumes the earlier ones passed.
func fileCause(f fileFacts) (LikelyCause, bool) {
	switch {
	case f.body == nil:
		return LikelyCause{Code: CauseFileMissing, Filename: f.filename,
			Message: "This file is no longer in the screenshots folder, so the report can't include it."}, true
	case !f.decoded:
		return LikelyCause{Code: CauseImageUnreadable, Filename: f.filename,
			Message: "This isn't a readable PNG or JPEG. It may be cut short, or not an image at all."}, true
	case math.Abs(float64(f.width)/float64(f.height)-16.0/9.0) > aspectTolerance:
		return LikelyCause{Code: CauseUnusualAspectRatio, Filename: f.filename,
			Message: fmt.Sprintf("This capture is %d×%d. Recall reads 16:9 captures, and ultrawide, 16:10 or cropped images move the text it looks for.", f.width, f.height)}, true
	}
	if _, ok := correlate.ParseFilenameTimestamp(f.filename); !ok {
		return LikelyCause{Code: CauseUnrecognizedFilename, Filename: f.filename,
			Message: "This filename doesn't match a known capture tool, so Recall can't date it or group it into a match. Renamed files and non-Overwatch images end up here."}, true
	}
	return LikelyCause{}, false
}

func versionOrUnknown(v string) string {
	if v == "" {
		return "(unknown version)"
	}
	return v
}
