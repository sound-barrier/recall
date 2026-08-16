package coach

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"recall/pkg/bundle"
)

// MaxNotesArchiveBytes caps the COMPRESSED notes archive a player may
// import (the HTTP body cap the app layer applies, mirrored here so a
// direct caller is bounded too). maxNotesEntryBytes caps notes.json
// DECOMPRESSED — the zip-bomb guard, same shape as the bundle's per-entry
// cap.
const (
	MaxNotesArchiveBytes       = 4 << 20
	maxNotesEntryBytes   int64 = 8 << 20
)

const (
	notesEntryName  = "notes.json"
	ledgerEntryName = "ledger.html"
)

// ArchiveKind is what an uploaded ZIP is, judged by its entry names alone.
type ArchiveKind int

const (
	// ArchiveUnknown — not a ZIP, or a ZIP carrying neither layout.
	ArchiveUnknown ArchiveKind = iota
	// ArchiveBundle — a player's bundle (manifest.json + data.json).
	ArchiveBundle
	// ArchiveCoachNotes — a coach's notes archive (notes.json).
	ArchiveCoachNotes
)

// SniffArchive tells a bundle from a notes archive by top-level entry
// names only — before any manifest or JSON is parsed, so a hostile body
// cannot influence which reader runs. notes.json wins when both layouts
// are present.
func SniffArchive(payload []byte) ArchiveKind {
	if !bundle.LooksLikeZIP(payload) {
		return ArchiveUnknown
	}
	zr, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		return ArchiveUnknown
	}
	names := make(map[string]bool, len(zr.File))
	for _, f := range zr.File {
		names[f.Name] = true
	}
	switch {
	case names[notesEntryName]:
		return ArchiveCoachNotes
	case names["manifest.json"] && names["data.json"]:
		return ArchiveBundle
	}
	return ArchiveUnknown
}

// WriteNotesArchive builds the archive a coach hands the player: notes.json
// (indented, the machine copy) plus ledger.html (the human copy), every
// entry stamped with now. The file is validated first so an archive this
// build writes is one it can read back.
func WriteNotesArchive(f NotesFile, now time.Time) ([]byte, error) {
	if err := ValidateNotesFile(f); err != nil {
		return nil, err
	}
	notesJSON, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("coach: encode notes.json: %w", err)
	}
	ledger, err := RenderLedger(f)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, entry := range []struct {
		name string
		body []byte
	}{{notesEntryName, append(notesJSON, '\n')}, {ledgerEntryName, ledger}} {
		if err := writeZipEntry(zw, entry.name, entry.body, now); err != nil {
			return nil, err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, fmt.Errorf("coach: close archive: %w", err)
	}
	return buf.Bytes(), nil
}

// writeZipEntry adds one deflated entry with an explicit mtime — without
// one, archive/zip stamps the MS-DOS epoch and the extracted files read as
// "Jan 1 1980".
func writeZipEntry(zw *zip.Writer, name string, body []byte, mt time.Time) error {
	w, err := zw.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Deflate, Modified: mt})
	if err != nil {
		return fmt.Errorf("coach: create %s: %w", name, err)
	}
	if _, err := w.Write(body); err != nil {
		return fmt.Errorf("coach: write %s: %w", name, err)
	}
	return nil
}

// ReadNotesArchive decodes and validates the notes archive a player
// imports. Only notes.json is ever read — ledger.html is an untrusted
// document the app never opens. Unknown JSON fields are tolerated so a
// newer minor build's file still stages here.
func ReadNotesArchive(payload []byte) (NotesFile, error) {
	f, _, err := readNotesArchive(payload)
	return f, err
}

// readNotesArchive is ReadNotesArchive plus the verbatim notes.json bytes,
// which the staging path hashes and keeps as the uploaded document.
func readNotesArchive(payload []byte) (NotesFile, []byte, error) {
	payload = stripBOM(payload)
	if len(payload) > MaxNotesArchiveBytes {
		return NotesFile{}, nil, fmt.Errorf("%w: archive exceeds 4 MiB", ErrNotesMalformed)
	}
	if !bundle.LooksLikeZIP(payload) {
		return NotesFile{}, nil, fmt.Errorf("%w: expected a coach notes archive (.zip)", ErrNotesMalformed)
	}
	zr, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		return NotesFile{}, nil, fmt.Errorf("%w: open zip: %w", ErrNotesMalformed, err)
	}
	raw, err := bundle.ReadZipEntry(zr, notesEntryName, maxNotesEntryBytes)
	if err != nil {
		return NotesFile{}, nil, fmt.Errorf("%w: %s: %w", ErrNotesMalformed, notesEntryName, err)
	}
	f, err := decodeNotesFile(raw)
	if err != nil {
		return NotesFile{}, nil, err
	}
	if err := ValidateNotesFile(f); err != nil {
		return NotesFile{}, nil, err
	}
	return f, raw, nil
}

// decodeNotesFile decodes notes.json bytes and normalizes tag slices to
// non-nil so every downstream marshal carries [] rather than null.
func decodeNotesFile(raw []byte) (NotesFile, error) {
	var f NotesFile
	if err := json.Unmarshal(raw, &f); err != nil {
		return NotesFile{}, fmt.Errorf("%w: decode %s: %w", ErrNotesMalformed, notesEntryName, err)
	}
	for i := range f.Notes {
		f.Notes[i].FocusTags = nonNilTags(f.Notes[i].FocusTags)
		f.Notes[i].ExtraTags = nonNilTags(f.Notes[i].ExtraTags)
	}
	return f, nil
}

// stripBOM trims a UTF-8 byte-order mark some editors prepend on save.
func stripBOM(b []byte) []byte {
	return bytes.TrimPrefix(b, []byte("\xef\xbb\xbf"))
}

// ArchiveFileName is the download name for a notes archive:
// recall-coach-notes-<handle slug>-<YYYYMMDD>.zip. The slug is ASCII
// lowercase alphanumerics with runs of anything else collapsed to one
// dash ("player" when nothing survives), so the name is safe on every
// filesystem and in a Content-Disposition header.
func ArchiveFileName(handle, sessionDate string) string {
	name := "recall-coach-notes-" + slugify(handle)
	if digits := digitsOnly(sessionDate); digits != "" {
		name += "-" + digits
	}
	return name + ".zip"
}

func slugify(s string) string {
	var b strings.Builder
	dash := true // suppress a leading dash
	for _, r := range strings.ToLower(s) {
		isAlnum := ('a' <= r && r <= 'z') || ('0' <= r && r <= '9')
		switch {
		case isAlnum:
			b.WriteRune(r)
			dash = false
		case !dash:
			b.WriteByte('-')
			dash = true
		}
	}
	slug := strings.TrimSuffix(b.String(), "-")
	if slug == "" {
		return "player"
	}
	return slug
}

func digitsOnly(s string) string {
	var b strings.Builder
	for _, r := range s {
		if '0' <= r && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// ContentHash is the identity of an uploaded notes.json — SHA-256 hex over
// its verbatim bytes, so the same file imported twice stages once.
func ContentHash(notesJSON []byte) string {
	sum := sha256.Sum256(notesJSON)
	return hex.EncodeToString(sum[:])
}
