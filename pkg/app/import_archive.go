package app

import (
	"archive/zip"
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

// readZipFile reads one bundle entry's decompressed content, bounded at
// maxZipEntryBytes. An entry larger than the cap is rejected as a likely
// decompression bomb. The io.LimitReader makes the resident size at most
// maxZipEntryBytes+1, so gosec G110 no longer applies — the read is explicitly
// bounded.
func readZipFile(zr *zip.Reader, name string) ([]byte, error) {
	for _, f := range zr.File {
		if f.Name != name {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return nil, err
		}
		defer func() { _ = rc.Close() }()
		// Read one byte past the cap so an entry sitting exactly at the cap
		// still succeeds while anything larger is detected.
		b, err := io.ReadAll(io.LimitReader(rc, maxZipEntryBytes+1))
		if err != nil {
			return nil, err
		}
		if int64(len(b)) > maxZipEntryBytes {
			return nil, fmt.Errorf("%w: entry %q exceeds %d bytes decompressed (possible zip bomb)", ErrImportMalformed, name, maxZipEntryBytes)
		}
		return b, nil
	}
	return nil, fmt.Errorf("zip: %q not found", name)
}

// looksLikeZIP returns true when the payload starts with the standard PKZip
// magic bytes. Cheap content-sniff used by ImportMatches to reject a payload
// that isn't a bundle before attempting to open it as an archive.
func looksLikeZIP(payload []byte) bool {
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
