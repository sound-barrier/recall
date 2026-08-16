package bundle

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

// maxZipEntryBytes caps the DECOMPRESSED size of any single entry read from an
// imported bundle. The /imports endpoint caps the COMPRESSED upload
// (server_backup.go), but DEFLATE can expand by ~1000x on repetitive input —
// so without a decompressed cap a small zip-bomb could balloon to tens of GB
// and OOM the process, and any host on the no-auth LAN can POST to /imports.
// 64 MiB per entry is generous for the largest real data.json (years of
// competitive history) while bounding memory hard. Exceeding it is treated as
// a malformed import (ErrImportMalformed → HTTP 400).
//
// Declared as a var, not a const, so tests can lower it to exercise the bomb
// path cheaply (the package-var test-seam pattern, same as update.go's URL
// seams).
var maxZipEntryBytes int64 = 64 << 20

// Contents is a bundle's two JSON documents, decoded and schema-checked: the
// manifest envelope (provenance, and the player identity when the bundle was
// shared for coaching) and the data.json row payload.
type Contents struct {
	Manifest ManifestV1
	Data     DataV2
}

// Read is the ZIP→typed step every bundle consumer is built on — Import
// merges Contents.Data into a store; a coaching session renders it in memory.
// It strips a leading BOM, sniffs for the PKZip magic, and decodes both core
// files. A payload that isn't a readable bundle wraps ErrImportMalformed
// (→ 400); a readable bundle whose manifest or data schema this build doesn't
// speak is a plain error (→ 409). A bundle from a build that predates the
// player identity reads back with Manifest.Player == nil.
func Read(payload []byte) (Contents, error) {
	payload = stripBOM(payload)
	if !LooksLikeZIP(payload) {
		return Contents{}, fmt.Errorf("%w: expected a Recall bundle (.zip)", ErrImportMalformed)
	}
	zr, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		return Contents{}, fmt.Errorf("%w: open zip: %w", ErrImportMalformed, err)
	}
	manifest, err := readManifestEntry(zr)
	if err != nil {
		return Contents{}, err
	}
	data, err := readDataEntry(zr)
	if err != nil {
		return Contents{}, err
	}
	return Contents{Manifest: manifest, Data: data}, nil
}

// readManifestEntry decodes manifest.json and checks its schema. Runs before
// data.json is touched so a future-layout bundle is refused on the envelope.
func readManifestEntry(zr *zip.Reader) (ManifestV1, error) {
	manifestBytes, err := ReadZipEntry(zr, "manifest.json", maxZipEntryBytes)
	if err != nil {
		return ManifestV1{}, fmt.Errorf("%w: missing manifest.json: %w", ErrImportMalformed, err)
	}
	var mf ManifestV1
	if err := json.Unmarshal(manifestBytes, &mf); err != nil {
		return ManifestV1{}, fmt.Errorf("%w: manifest decode: %w", ErrImportMalformed, err)
	}
	if mf.Schema != BundleSchemaV1 {
		return ManifestV1{}, fmt.Errorf("import: unsupported bundle schema %q (this build expects %q)", mf.Schema, BundleSchemaV1)
	}
	return mf, nil
}

// readDataEntry decodes data.json and accepts either data schema — a v1
// payload simply has no user layer.
func readDataEntry(zr *zip.Reader) (DataV2, error) {
	dataBytes, err := ReadZipEntry(zr, "data.json", maxZipEntryBytes)
	if err != nil {
		return DataV2{}, fmt.Errorf("%w: missing data.json: %w", ErrImportMalformed, err)
	}
	var data DataV2
	if err := json.Unmarshal(dataBytes, &data); err != nil {
		return DataV2{}, fmt.Errorf("%w: data.json decode: %w", ErrImportMalformed, err)
	}
	if data.Schema != exportSchemaV1 && data.Schema != exportSchemaV2 {
		return DataV2{}, fmt.Errorf("import: unsupported data schema %q (this build accepts %q and %q)", data.Schema, exportSchemaV1, exportSchemaV2)
	}
	return data, nil
}

// ReadZipEntry reads one archive entry's decompressed content, bounded at
// maxBytes. An entry larger than the cap is rejected as a likely decompression
// bomb, wrapping ErrImportMalformed. Exported so a sibling package reading a
// different archive (a coach's notes file) applies the same bounded read with
// its own cap. An absent entry is an error naming it.
func ReadZipEntry(zr *zip.Reader, name string, maxBytes int64) ([]byte, error) {
	for _, f := range zr.File {
		if f.Name == name {
			return readEntryCapped(f, maxBytes)
		}
	}
	return nil, fmt.Errorf("zip: %q not found", name)
}

// readEntryCapped is the bounded read behind ReadZipEntry and Validate. The
// io.LimitReader makes the resident size at most maxBytes+1, so gosec G110 no
// longer applies — the read is explicitly bounded.
func readEntryCapped(f *zip.File, maxBytes int64) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer func() { _ = rc.Close() }()
	// Read one byte past the cap so an entry sitting exactly at the cap
	// still succeeds while anything larger is detected.
	b, err := io.ReadAll(io.LimitReader(rc, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(b)) > maxBytes {
		return nil, fmt.Errorf("%w: entry %q exceeds %d bytes decompressed (possible zip bomb)", ErrImportMalformed, f.Name, maxBytes)
	}
	return b, nil
}

// LooksLikeZIP returns true when the payload starts with the standard PKZip
// magic bytes. Cheap content-sniff used to reject a payload that isn't an
// archive before attempting to open it — and, by the import overload, to tell
// a bundle from a notes file before any manifest parse.
func LooksLikeZIP(payload []byte) bool {
	return len(payload) >= 4 &&
		payload[0] == 0x50 && payload[1] == 0x4B &&
		(payload[2] == 0x03 || payload[2] == 0x05 || payload[2] == 0x07) &&
		(payload[3] == 0x04 || payload[3] == 0x06 || payload[3] == 0x08)
}

// stripBOM trims a UTF-8 byte-order mark off the front of a payload if one is
// present. Some editors (looking at you, Notepad) prepend a BOM when saving as
// UTF-8, which breaks json.Unmarshal.
func stripBOM(b []byte) []byte {
	const bom = "\xef\xbb\xbf"
	if strings.HasPrefix(string(b[:min(len(b), 3)]), bom) {
		return b[3:]
	}
	return b
}
