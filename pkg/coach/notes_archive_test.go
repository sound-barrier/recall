package coach_test

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"reflect"
	"strings"
	"testing"

	"recall/pkg/coach"
)

func readArchiveEntries(t *testing.T, payload []byte) map[string][]byte {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		t.Fatalf("open zip: %v", err)
	}
	out := map[string][]byte{}
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("open %s: %v", f.Name, err)
		}
		b, err := io.ReadAll(rc)
		_ = rc.Close()
		if err != nil {
			t.Fatalf("read %s: %v", f.Name, err)
		}
		out[f.Name] = b
		if !f.Modified.Equal(fixedNow) {
			t.Errorf("%s mtime = %v, want %v", f.Name, f.Modified, fixedNow)
		}
	}
	return out
}

func TestNotesArchive_RoundTrip(t *testing.T) {
	f := validNotesFile()
	payload, err := coach.WriteNotesArchive(f, fixedNow)
	if err != nil {
		t.Fatalf("WriteNotesArchive: %v", err)
	}
	entries := readArchiveEntries(t, payload)
	if _, ok := entries["notes.json"]; !ok {
		t.Fatal("archive lacks notes.json")
	}
	if !bytes.HasPrefix(entries["ledger.html"], []byte("<!doctype html>")) {
		t.Errorf("ledger.html missing or not a document: %.40q", entries["ledger.html"])
	}
	if !strings.HasPrefix(string(entries["notes.json"]), "{\n  \"schema\": \"recall-coach-notes/v1\"") {
		t.Errorf("notes.json is not indented with schema first: %.60q", entries["notes.json"])
	}
	if coach.SniffArchive(payload) != coach.ArchiveCoachNotes {
		t.Error("SniffArchive(notes archive) != ArchiveCoachNotes")
	}

	got, err := coach.ReadNotesArchive(payload)
	if err != nil {
		t.Fatalf("ReadNotesArchive: %v", err)
	}
	if !reflect.DeepEqual(got, f) {
		t.Errorf("round trip changed the file:\n got %+v\nwant %+v", got, f)
	}
}

func TestWriteNotesArchive_RefusesAnInvalidFile(t *testing.T) {
	f := validNotesFile()
	f.CoachName = ""
	if _, err := coach.WriteNotesArchive(f, fixedNow); !errors.Is(err, coach.ErrNotesMalformed) {
		t.Fatalf("err = %v, want ErrNotesMalformed", err)
	}
}

func TestSniffArchive_ByEntryNamesOnly(t *testing.T) {
	bundleZip := exportBundle(t, seededStore(t), nil)
	tests := []struct {
		name    string
		payload []byte
		want    coach.ArchiveKind
	}{
		{"real bundle", bundleZip, coach.ArchiveBundle},
		{"manifest+data with junk bodies", zipWithEntries(t, map[string][]byte{"manifest.json": []byte("x"), "data.json": []byte("y")}), coach.ArchiveBundle},
		{"notes.json alone", zipWithEntries(t, map[string][]byte{"notes.json": []byte("x")}), coach.ArchiveCoachNotes},
		{"notes.json beside a manifest", zipWithEntries(t, map[string][]byte{"notes.json": []byte("x"), "manifest.json": []byte("y"), "data.json": []byte("z")}), coach.ArchiveCoachNotes},
		{"manifest only", zipWithEntries(t, map[string][]byte{"manifest.json": []byte("x")}), coach.ArchiveUnknown},
		{"nested notes.json", zipWithEntries(t, map[string][]byte{"dir/notes.json": []byte("x")}), coach.ArchiveUnknown},
		{"empty zip", zipWithEntries(t, nil), coach.ArchiveUnknown},
		{"not a zip", []byte("hello"), coach.ArchiveUnknown},
		{"bom then json", []byte("\xef\xbb\xbf{}"), coach.ArchiveUnknown},
		{"nil", nil, coach.ArchiveUnknown},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := coach.SniffArchive(tc.payload); got != tc.want {
				t.Errorf("SniffArchive = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestReadNotesArchive_Rejects(t *testing.T) {
	valid := validNotesFile()
	validJSON, _ := json.Marshal(valid)
	unsupported := valid
	unsupported.Schema = "recall-coach-notes/v9"
	unsupportedJSON, _ := json.Marshal(unsupported)
	blankHandle := valid
	blankHandle.Player.Handle = ""
	blankHandleJSON, _ := json.Marshal(blankHandle)
	oversizeJSON := append(append([]byte(`{"schema":"recall-coach-notes/v1","pad":"`), bytes.Repeat([]byte(" "), int(coach.MaxNotesEntryBytes))...), []byte(`"}`)...)
	oversizePayload := append([]byte("PK\x03\x04"), bytes.Repeat([]byte("x"), coach.MaxNotesArchiveBytes)...)

	tests := []struct {
		name    string
		payload []byte
		want    error
		reason  string
	}{
		{"not a zip", []byte("{}"), coach.ErrNotesMalformed, "zip"},
		{"empty", nil, coach.ErrNotesMalformed, "zip"},
		{"zip without notes.json", zipWithEntries(t, map[string][]byte{"ledger.html": []byte("<p>")}), coach.ErrNotesMalformed, "notes.json"},
		{"a bundle", exportBundle(t, seededStore(t), nil), coach.ErrNotesMalformed, "notes.json"},
		{"notes.json not json", zipWithEntries(t, map[string][]byte{"notes.json": []byte("{nope")}), coach.ErrNotesMalformed, "decode"},
		{"unsupported schema", zipWithEntries(t, map[string][]byte{"notes.json": unsupportedJSON}), coach.ErrNotesUnsupportedSchema, "recall-coach-notes/v9"},
		{"fails validation", zipWithEntries(t, map[string][]byte{"notes.json": blankHandleJSON}), coach.ErrNotesMalformed, "handle"},
		{"notes.json over the entry cap", zipWithEntries(t, map[string][]byte{"notes.json": oversizeJSON}), coach.ErrNotesMalformed, "exceeds"},
		{"payload over the archive cap", oversizePayload, coach.ErrNotesMalformed, "4 MiB"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := coach.ReadNotesArchive(tc.payload)
			if !errors.Is(err, tc.want) {
				t.Fatalf("err = %v, want %v", err, tc.want)
			}
			if !strings.Contains(err.Error(), tc.reason) {
				t.Errorf("err = %q, want it to name %q", err, tc.reason)
			}
		})
	}

	// A BOM-prefixed archive still reads; unknown fields are tolerated so a
	// newer minor build's file still stages here.
	forward := map[string]any{}
	if err := json.Unmarshal(validJSON, &forward); err != nil {
		t.Fatal(err)
	}
	forward["future_field"] = true
	forwardJSON, _ := json.Marshal(forward)
	payload := append([]byte("\xef\xbb\xbf"), zipWithEntries(t, map[string][]byte{"notes.json": forwardJSON})...)
	got, err := coach.ReadNotesArchive(payload)
	if err != nil {
		t.Fatalf("ReadNotesArchive(bom + unknown field) = %v", err)
	}
	if got.CoachName != "Ordo" || len(got.Notes) != 2 {
		t.Errorf("decoded file lost content: %+v", got)
	}
}

func TestReadNotesArchive_NeverReadsTheLedger(t *testing.T) {
	validJSON, _ := json.Marshal(validNotesFile())
	hostile := zipWithEntries(t, map[string][]byte{
		"notes.json":  validJSON,
		"ledger.html": bytes.Repeat([]byte("<script>"), 1<<20),
	})
	if _, err := coach.ReadNotesArchive(hostile); err != nil {
		t.Fatalf("a hostile ledger.html must not affect the read: %v", err)
	}
}

func TestArchiveFileName(t *testing.T) {
	tests := []struct {
		handle, date, want string
	}{
		{"Sable", "2026-08-15", "recall-coach-notes-sable-20260815.zip"},
		{"  Sable  Two ", "2026-08-15", "recall-coach-notes-sable-two-20260815.zip"},
		{"Ana#1234", "2026-01-02", "recall-coach-notes-ana-1234-20260102.zip"},
		{"---", "2026-08-15", "recall-coach-notes-player-20260815.zip"},
		{"", "2026-08-15", "recall-coach-notes-player-20260815.zip"},
		{"Ñandú", "2026-08-15", "recall-coach-notes-and-20260815.zip"},
		{"../../etc/passwd", "2026-08-15", "recall-coach-notes-etc-passwd-20260815.zip"},
		{"Sable", "", "recall-coach-notes-sable.zip"},
	}
	for _, tc := range tests {
		if got := coach.ArchiveFileName(tc.handle, tc.date); got != tc.want {
			t.Errorf("ArchiveFileName(%q, %q) = %q, want %q", tc.handle, tc.date, got, tc.want)
		}
	}
}

func TestContentHash_IsSHA256Hex(t *testing.T) {
	sum := sha256.Sum256([]byte("abc"))
	if got := coach.ContentHash([]byte("abc")); got != hex.EncodeToString(sum[:]) {
		t.Errorf("ContentHash = %q, want sha256 hex", got)
	}
	if coach.ContentHash([]byte("abc")) == coach.ContentHash([]byte("zzz")) {
		t.Error("distinct inputs hashed equal")
	}
}
