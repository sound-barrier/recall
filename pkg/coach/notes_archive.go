package coach

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
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
func WriteNotesArchive(f NotesFile, sheetHTML []byte, now time.Time) ([]byte, error) {
	if err := ValidateNotesFile(f); err != nil {
		return nil, err
	}
	if err := validateSheetHTML(sheetHTML); err != nil {
		return nil, err
	}
	notesJSON, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("coach: encode notes.json: %w", err)
	}
	ledger := sheetHTML
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

// ErrSheetMissing rejects an archive with no human copy in it.
var ErrSheetMissing = errors.New("the review page is required")

// ErrSheetTooLarge rejects a human copy larger than the archive allows.
var ErrSheetTooLarge = errors.New("the review page is too large")

// validateSheetHTML holds the incoming page to the two things Go can check
// about it: that it exists, and that it is not enormous.
//
// Deliberately nothing else. The page is BUILT IN THE FRONTEND now, where
// the real stylesheets live, and Go's role is to put the bytes in a zip.
// This package has never parsed the human copy — the doc below already
// promises the app does not read it back — and taking it from the frontend
// rather than rendering it here does not change that promise, only who
// wrote the bytes it declines to parse.
func validateSheetHTML(sheetHTML []byte) error {
	if len(sheetHTML) == 0 {
		return ErrSheetMissing
	}
	if int64(len(sheetHTML)) > maxNotesEntryBytes {
		return fmt.Errorf("%w: %d bytes", ErrSheetTooLarge, len(sheetHTML))
	}
	return nil
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

// ReadNotesArchive decodes and validates the notes archive a player imports,
// returning the file and the verbatim notes.json bytes the staging path hashes
// and keeps as the uploaded document. Only notes.json is ever read —
// ledger.html is an untrusted document the app never opens. Unknown JSON fields
// are tolerated so a newer minor build's file still stages here.
//
// One function rather than an exported wrapper over an unexported twin: the
// wrapper existed because staging was in this package and wanted the bytes,
// while everyone else wanted only the file. Staging lives in pkg/coachreturn
// now and reads this directly, so the split had nothing left to hide.
func ReadNotesArchive(payload []byte) (NotesFile, []byte, error) {
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
	f, err := DecodeNotesFile(raw)
	if err != nil {
		return NotesFile{}, nil, err
	}
	if err := ValidateNotesFile(f); err != nil {
		return NotesFile{}, nil, err
	}
	return f, raw, nil
}

// DecodeNotesFile decodes notes.json bytes and normalizes tag slices to
// non-nil so every downstream marshal carries [] rather than null. Exported for
// pkg/coachreturn, which decodes a staged archive straight from the store.
func DecodeNotesFile(raw []byte) (NotesFile, error) {
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
