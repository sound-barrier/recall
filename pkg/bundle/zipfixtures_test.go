package bundle_test

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"sort"
	"testing"
)

// Wire-schema strings spelled literally rather than read back out of the
// package under test: a rename that breaks every bundle already on disk must
// fail these tests, not travel through them.
const (
	bundleSchemaV1 = "recall-bundle/v1"
	dataSchemaV1   = "recall-export/v1"
	dataSchemaV2   = "recall-export/v2"
	dataSchemaV3   = "recall-export/v3"
	dataSchemaV4   = "recall-export/v4"
)

// zipEntry is one member of a synthetic bundle ZIP. `raw` writes the body
// verbatim under the declared method and sizes (zip.Writer.CreateRaw), which is
// the only way to build the archives a hostile uploader can hand us: an entry
// declaring an unsupported compression algorithm, or one declaring DEFLATE over
// bytes that are not a DEFLATE stream.
type zipEntry struct {
	name   string
	body   []byte
	method uint16
	raw    bool
}

func fileEntry(name string, body []byte) zipEntry {
	return zipEntry{name: name, body: body, method: zip.Deflate}
}

func jsonFileEntry(t *testing.T, name string, v any) zipEntry {
	t.Helper()
	return fileEntry(name, mustJSON(t, v))
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal %T: %v", v, err)
	}
	return b
}

func buildZip(t *testing.T, entries ...zipEntry) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, e := range entries {
		writeZipEntry(t, zw, e)
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}
	return buf.Bytes()
}

func writeZipEntry(t *testing.T, zw *zip.Writer, e zipEntry) {
	t.Helper()
	hdr := &zip.FileHeader{Name: e.name, Method: e.method}
	create := zw.CreateHeader
	if e.raw {
		hdr.CompressedSize64 = uint64(len(e.body))
		hdr.UncompressedSize64 = uint64(len(e.body))
		create = zw.CreateRaw
	}
	w, err := create(hdr)
	if err != nil {
		t.Fatalf("zip create %q: %v", e.name, err)
	}
	if _, err := w.Write(e.body); err != nil {
		t.Fatalf("zip write %q: %v", e.name, err)
	}
}

// entrySize returns one entry's decompressed byte count — the exact quantity
// readZipFile compares against its per-entry cap.
func entrySize(t *testing.T, payload []byte, name string) int64 {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		t.Fatalf("open zip: %v", err)
	}
	for _, f := range zr.File {
		if f.Name != name {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("open %s: %v", name, err)
		}
		defer func() { _ = rc.Close() }()
		b, err := io.ReadAll(rc)
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		return int64(len(b))
	}
	t.Fatalf("entry %q not in zip", name)
	return 0
}

// sortedKeys returns a map's keys in ascending order so fixture assembly is
// deterministic.
func sortedKeys[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
