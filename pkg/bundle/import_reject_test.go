package bundle_test

import (
	"archive/zip"
	"bytes"
	"errors"
	"strings"
	"testing"

	"recall/pkg/bundle"
	"recall/pkg/db/dbtest"
)

// okManifest / okData are the smallest internally-consistent bundle pieces the
// import path accepts. Every rejection case below is exactly one mutation away
// from them, so a failure names the single thing that changed.
func okManifest() map[string]any {
	return map[string]any{"schema": bundleSchemaV1, "recall_version": seededVersion}
}

func okData() map[string]any {
	return map[string]any{
		"schema":    dataSchemaV2,
		"summaries": []map[string]any{{"Filename": "a.png", "MatchKey": "m1"}},
	}
}

func okPayload(t *testing.T) []byte {
	t.Helper()
	return buildZip(t,
		jsonFileEntry(t, "manifest.json", okManifest()),
		jsonFileEntry(t, "data.json", okData()),
	)
}

// rejectCase is one hostile or broken payload plus the message the rejection
// must carry.
type rejectCase struct {
	name    string
	payload func(*testing.T) []byte
	wantMsg string
}

func runRejectCases(t *testing.T, cases []rejectCase) {
	t.Helper()
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assertMalformed(t, tc.payload(t), tc.wantMsg)
		})
	}
}

// The 400-vs-409 split is the contract pkg/cmd's import handler branches on:
// ErrImportMalformed means "this payload is not a readable bundle" (400),
// anything else means "readable but we refuse it" (409). Getting the class
// wrong hands the user the wrong remedy, so every rejection pins both the
// class and the message that names the defect.
//
// This half covers the archive itself — nothing here even gets as far as
// looking for a manifest.
func TestImport_RejectsUnreadableArchives(t *testing.T) {
	runRejectCases(t, []rejectCase{
		{
			name:    "not an archive at all",
			payload: func(*testing.T) []byte { return []byte("this is a text file, not a bundle") },
			wantMsg: "expected a Recall bundle (.zip)",
		},
		{
			name:    "empty payload is too short to sniff",
			payload: func(*testing.T) []byte { return nil },
			wantMsg: "expected a Recall bundle (.zip)",
		},
		{
			name:    "PKZip magic over truncated bytes",
			payload: func(*testing.T) []byte { return []byte("PK\x03\x04 truncated before the central directory") },
			wantMsg: "open zip:",
		},
		{
			name: "data.json declares an unsupported compression algorithm",
			payload: func(t *testing.T) []byte {
				t.Helper()
				return buildZip(t,
					jsonFileEntry(t, "manifest.json", okManifest()),
					zipEntry{name: "data.json", body: mustJSON(t, okData()), method: 99, raw: true},
				)
			},
			wantMsg: "zip: unsupported compression algorithm",
		},
		{
			name: "data.json declares DEFLATE over bytes that are not DEFLATE",
			payload: func(t *testing.T) []byte {
				t.Helper()
				return buildZip(t,
					jsonFileEntry(t, "manifest.json", okManifest()),
					zipEntry{name: "data.json", body: []byte("not a deflate stream at all"), method: 8, raw: true},
				)
			},
			wantMsg: "flate:",
		},
	})
}

// The second half: a readable archive whose two core files are absent, hiding
// under a path we must not fuzzy-match, or undecodable. All of them are 400s —
// the sentinel's own doc comment classes an "undecodable manifest or data.json"
// as a malformed payload, and a truncated upload is the common way to get one.
func TestImport_RejectsMissingOrUndecodableCoreFiles(t *testing.T) {
	runRejectCases(t, []rejectCase{
		{
			name: "manifest.json absent",
			payload: func(t *testing.T) []byte {
				t.Helper()
				return buildZip(t, jsonFileEntry(t, "data.json", okData()))
			},
			wantMsg: `missing manifest.json: zip: "manifest.json" not found`,
		},
		{
			name: "manifest.json nested under a directory is not the manifest",
			payload: func(t *testing.T) []byte {
				t.Helper()
				return buildZip(t,
					jsonFileEntry(t, "recall-bundle/manifest.json", okManifest()),
					jsonFileEntry(t, "data.json", okData()),
				)
			},
			wantMsg: `missing manifest.json: zip: "manifest.json" not found`,
		},
		{
			name: "manifest.json is not JSON",
			payload: func(t *testing.T) []byte {
				t.Helper()
				return buildZip(t,
					fileEntry("manifest.json", []byte("{not json")),
					jsonFileEntry(t, "data.json", okData()),
				)
			},
			wantMsg: "manifest decode:",
		},
		{
			name: "data.json absent",
			payload: func(t *testing.T) []byte {
				t.Helper()
				return buildZip(t, jsonFileEntry(t, "manifest.json", okManifest()))
			},
			wantMsg: `missing data.json: zip: "data.json" not found`,
		},
		{
			name: "data.json is not JSON",
			payload: func(t *testing.T) []byte {
				t.Helper()
				return buildZip(t,
					jsonFileEntry(t, "manifest.json", okManifest()),
					fileEntry("data.json", []byte(`{"schema":"recall-export/v2","summ`)),
				)
			},
			wantMsg: "data.json decode:",
		},
	})
}

// A payload that parses cleanly but declares a schema this build doesn't speak
// is a 409, NOT a 400: the bytes are fine, the build is wrong. Classing these
// as malformed would tell the user to re-download a bundle that is not broken.
func TestImport_RejectsUnsupportedSchemasAsNonMalformed(t *testing.T) {
	tests := []struct {
		name    string
		payload func(*testing.T) []byte
		wantMsg string
	}{
		{
			name: "bundle manifest from a future layout",
			payload: func(t *testing.T) []byte {
				t.Helper()
				return buildZip(t,
					jsonFileEntry(t, "manifest.json", map[string]any{"schema": "recall-bundle/v2"}),
					jsonFileEntry(t, "data.json", okData()),
				)
			},
			wantMsg: `import: unsupported bundle schema "recall-bundle/v2" (this build expects "recall-bundle/v1")`,
		},
		{
			name: "manifest with no schema field at all",
			payload: func(t *testing.T) []byte {
				t.Helper()
				return buildZip(t,
					jsonFileEntry(t, "manifest.json", map[string]any{"recall_version": "0.1.0"}),
					jsonFileEntry(t, "data.json", okData()),
				)
			},
			wantMsg: `import: unsupported bundle schema "" (this build expects "recall-bundle/v1")`,
		},
		{
			name: "data.json from a future export schema",
			payload: func(t *testing.T) []byte {
				t.Helper()
				d := okData()
				d["schema"] = "recall-export/v99"
				return buildZip(t,
					jsonFileEntry(t, "manifest.json", okManifest()),
					jsonFileEntry(t, "data.json", d),
				)
			},
			wantMsg: `import: unsupported data schema "recall-export/v99" (this build accepts recall-export/v1, recall-export/v2, recall-export/v3, recall-export/v4)`,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			for _, err := range []error{importErr(t, tc.payload(t)), readErr(t, tc.payload(t))} {
				if errors.Is(err, bundle.ErrImportMalformed) {
					t.Fatalf("err = %v, must NOT be ErrImportMalformed (schema skew is a 409, not a 400)", err)
				}
				if err.Error() != tc.wantMsg {
					t.Fatalf("err = %q, want %q", err.Error(), tc.wantMsg)
				}
			}
		})
	}
}

// The decompressed per-entry cap is the only thing standing between a 40 KB
// upload and tens of GB of resident memory, and the "one byte past the cap"
// read is what makes an entry sitting exactly at the cap still legal. Both
// sides of that boundary are pinned here, against the cap the CALLER passes —
// a sibling package reading a notes archive brings its own, smaller number.
func TestReadZipEntry_HonorsTheCallerCap(t *testing.T) {
	payload := okPayload(t)
	dataSize := entrySize(t, payload, "data.json")
	zr, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		t.Fatalf("open zip: %v", err)
	}

	t.Run("entry exactly at the cap is accepted", func(t *testing.T) {
		got, err := bundle.ReadZipEntry(zr, "data.json", dataSize)
		if err != nil {
			t.Fatalf("entry of exactly %d bytes must read; got %v", dataSize, err)
		}
		if int64(len(got)) != dataSize {
			t.Errorf("read %d bytes, want %d", len(got), dataSize)
		}
	})

	t.Run("entry one byte over the cap is rejected as a bomb", func(t *testing.T) {
		_, err := bundle.ReadZipEntry(zr, "data.json", dataSize-1)
		if !errors.Is(err, bundle.ErrImportMalformed) {
			t.Fatalf("err = %v, want it to wrap ErrImportMalformed (the 400 class)", err)
		}
		for _, want := range []string{`entry "data.json" exceeds`, "possible zip bomb"} {
			if !strings.Contains(err.Error(), want) {
				t.Errorf("err = %q, want it to mention %q", err, want)
			}
		}
	})

	t.Run("an absent entry is named", func(t *testing.T) {
		_, err := bundle.ReadZipEntry(zr, "notes.json", dataSize)
		if err == nil || err.Error() != `zip: "notes.json" not found` {
			t.Fatalf("err = %v, want the not-found message", err)
		}
	})
}

// Read and Import share one cap for the bundle's own entries; lowering it
// through the seam proves the wiring, and that the bomb still classes as a
// malformed payload at the top of the stack.
func TestImport_OverCapEntryIsMalformed(t *testing.T) {
	payload := okPayload(t)
	withEntryCap(t, entrySize(t, payload, "data.json")-1)
	assertMalformed(t, payload, "possible zip bomb")
}

// A UTF-8 BOM in front of the archive (Notepad's parting gift when a user
// round-trips the file through an editor) must be stripped, not rejected.
func TestImport_StripsLeadingByteOrderMark(t *testing.T) {
	payload := append([]byte("\xef\xbb\xbf"), okPayload(t)...)
	store := dbtest.New()
	summary, err := bundle.Import(store, payload)
	if err != nil {
		t.Fatalf("BOM-prefixed bundle must import: %v", err)
	}
	if summary.Imported != 1 {
		t.Fatalf("Imported = %d, want 1", summary.Imported)
	}
}

// withEntryCap lowers the decompressed per-entry cap for one test and restores
// the production value afterwards.
func withEntryCap(t *testing.T, n int64) {
	t.Helper()
	prev := *bundle.MaxZipEntryBytes
	*bundle.MaxZipEntryBytes = n
	t.Cleanup(func() { *bundle.MaxZipEntryBytes = prev })
}

func importErr(t *testing.T, payload []byte) error {
	t.Helper()
	_, err := bundle.Import(dbtest.New(), payload)
	if err == nil {
		t.Fatal("Import succeeded, want an error")
	}
	return err
}

func readErr(t *testing.T, payload []byte) error {
	t.Helper()
	_, err := bundle.Read(payload)
	if err == nil {
		t.Fatal("Read succeeded, want an error")
	}
	return err
}

// assertMalformed holds Import AND Read to the same 400 class and message:
// Read is the ZIP→typed step Import is built on, and a coaching session opened
// through Read must tell the user the same thing Import… would have.
func assertMalformed(t *testing.T, payload []byte, wantMsg string) {
	t.Helper()
	for _, err := range []error{importErr(t, payload), readErr(t, payload)} {
		if !errors.Is(err, bundle.ErrImportMalformed) {
			t.Errorf("err = %v, want it to wrap ErrImportMalformed (the 400 class)", err)
		}
		if !strings.Contains(err.Error(), wantMsg) {
			t.Errorf("err = %q, want it to mention %q", err.Error(), wantMsg)
		}
	}
}
