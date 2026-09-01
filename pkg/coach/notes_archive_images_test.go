package coach_test

import (
	"bytes"
	"testing"
	"time"

	"recall/pkg/coach"
	"recall/pkg/db"
)

// The frame a coach pins has to reach the player.
//
// Before this, an attachment was a reference and nothing else: the digest
// traveled inside notes.json and the bytes stayed on the coach's disk, so the
// player opened a review naming a picture their database had never seen. These
// hold the archive to carrying both, and to refusing the one shape that would
// corrupt its own identity — a claim without the thing claimed.

var onePixel = []byte{
	0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a,
	0x00, 0x00, 0x00, 0x0d, 'I', 'H', 'D', 'R',
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
	0x00, 0x00, 0x00, 0x0a, 'I', 'D', 'A', 'T',
	0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01,
	0x0d, 0x0a, 0x2d, 0xb4,
	0x00, 0x00, 0x00, 0x00, 'I', 'E', 'N', 'D', 0xae, 0x42, 0x60, 0x82,
}

func fileWithFrame(t *testing.T, sha string) coach.NotesFile {
	t.Helper()
	return coach.NotesFile{
		Schema: "recall-coach-notes/v1", CoachName: "Ordo",
		Player:      coach.Player{Handle: "Sable", Kind: "player"},
		SessionDate: "2026-08-15",
		Notes: []coach.Note{{
			NoteID:   "11111111-2222-3333-4444-555555555555",
			MatchKey: "match-2026-08-15T21-00-00", Kind: "note", Text: "Hold the high ground.",
			Moments: []coach.Moment{{
				MomentID: "m-1", MatchClock: "03:23", Text: "here", ImageSHA256: sha,
			}},
		}},
	}
}

func TestNotesArchive_CarriesTheFrameItsMomentsName(t *testing.T) {
	sha := db.MomentImageDigest(onePixel)
	payload, err := coach.WriteNotesArchive(
		fileWithFrame(t, sha), []byte("<html>ledger</html>"),
		map[string][]byte{sha: onePixel}, time.Now())
	if err != nil {
		t.Fatalf("write: %v", err)
	}

	images, err := coach.ReadNotesArchiveImages(payload)
	if err != nil {
		t.Fatalf("read images: %v", err)
	}
	if !bytes.Equal(images[sha], onePixel) {
		t.Fatalf("the frame did not survive the archive: %d bytes back", len(images[sha]))
	}

	// And the reference is still inside notes.json, which is what the
	// archive's identity is computed over.
	f, _, err := coach.ReadNotesArchive(payload)
	if err != nil {
		t.Fatalf("read notes: %v", err)
	}
	if got := f.Notes[0].Moments[0].ImageSHA256; got != sha {
		t.Fatalf("moment names %q, want %q", got, sha)
	}
}

func TestNotesArchive_RefusesToClaimAFrameItDoesNotCarry(t *testing.T) {
	// An archive that names a picture it does not hold is worse than one with
	// no picture: the reference rides inside notes.json, whose hash IS the
	// archive's identity, so the claim would travel while the bytes did not.
	sha := db.MomentImageDigest(onePixel)
	_, err := coach.WriteNotesArchive(
		fileWithFrame(t, sha), []byte("<html>ledger</html>"), nil, time.Now())
	if err == nil {
		t.Fatal("wrote an archive naming a frame it does not carry")
	}
}

func TestNotesArchive_StillSniffsAsNotesWithImagesPresent(t *testing.T) {
	// The sniffer keys on notes.json being present, not on it being alone.
	sha := db.MomentImageDigest(onePixel)
	payload, err := coach.WriteNotesArchive(
		fileWithFrame(t, sha), []byte("<html>ledger</html>"),
		map[string][]byte{sha: onePixel}, time.Now())
	if err != nil {
		t.Fatalf("write: %v", err)
	}
	if got := coach.SniffArchive(payload); got != coach.ArchiveCoachNotes {
		t.Fatalf("SniffArchive = %v, want ArchiveCoachNotes", got)
	}
}

func TestNotesArchive_RefusesAFrameThatIsNotItsOwnDigest(t *testing.T) {
	// The entry name IS the content address. An archive that files bytes under
	// somebody else's digest would make the player's content-addressed store
	// disagree with itself about what that digest names.
	sha := db.MomentImageDigest(onePixel)
	payload, err := coach.WriteNotesArchive(
		fileWithFrame(t, sha), []byte("<html>ledger</html>"),
		map[string][]byte{sha: onePixel}, time.Now())
	if err != nil {
		t.Fatalf("write: %v", err)
	}
	// Swap the bytes under the same name by rebuilding with a lie.
	lied, err := coach.WriteNotesArchive(
		fileWithFrame(t, sha), []byte("<html>ledger</html>"),
		map[string][]byte{sha: append([]byte("not the same"), onePixel...)}, time.Now())
	if err != nil {
		t.Fatalf("write lied: %v", err)
	}
	if _, err := coach.ReadNotesArchiveImages(lied); err == nil {
		t.Fatal("accepted a frame filed under a digest that is not its own")
	}
	if _, err := coach.ReadNotesArchiveImages(payload); err != nil {
		t.Fatalf("refused an honest archive: %v", err)
	}
}
