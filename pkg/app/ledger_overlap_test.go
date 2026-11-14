package app_test

import (
	"errors"
	"testing"

	"recall/pkg/app"
	"recall/pkg/db"
	"recall/pkg/parser"
)

// The per-file ledgers record facts that hold AT ONCE, which is why they are
// not one status column. These pin the two overlaps the parse path produces.

// A file's content hash is registered before OCR (dedup and the claims ledger
// need it whatever the parse does), so a file that then fails to parse is
// both registered and failed.
func TestLedgers_AFailedFileIsStillRegisteredByHash(t *testing.T) {
	a, fake := newParseReadyApp(t)
	writeFile(t, app.SettingsOf(a).ScreenshotsDir, "broken.png", []byte("not a png"))
	stubParse(t, func(progress parser.ProgressFunc) error {
		progress(1, 1, "broken.png", nil, errors.New("decoding image: png: invalid format"))
		return nil
	})
	mustNoErr(t, a.ParseScreenshots())

	file := db.FileRef{DirID: parseDirID(t, a, fake), Filename: "broken.png"}
	if _, ok := fake.IngestedFiles[file]; !ok {
		t.Error("the failed file's hash was not registered")
	}
	if _, ok := fake.FailedFiles[file]; !ok {
		t.Error("the failed file has no failure row")
	}
}

// A recognized screen whose read was degraded is skip-listed AND kept on the
// Failed list so the user can see what went wrong.
func TestLedgers_ADegradedRecognizedScreenIsBothSkippedAndFailed(t *testing.T) {
	a, fake := newParseReadyApp(t)
	stubParse(t, func(progress parser.ProgressFunc) error {
		progress(1, 1, "heroes.png", &parser.MatchResult{AllHeroes: true, Warnings: []string{"card OCR failed"}}, nil)
		return nil
	})
	mustNoErr(t, a.ParseScreenshots())

	file := db.FileRef{DirID: parseDirID(t, a, fake), Filename: "heroes.png"}
	if !fake.AllHeroes[file] {
		t.Error("the recognized screen was not skip-listed")
	}
	if _, ok := fake.FailedFiles[file]; !ok {
		t.Error("the degraded read has no failure row")
	}
}
