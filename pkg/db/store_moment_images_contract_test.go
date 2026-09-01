package db_test

import (
	"bytes"
	"testing"
	"time"

	"recall/pkg/db"
)

// Images attached to a moment, against every Store implementation.
//
// This is the first thing the app takes CUSTODY of. Every other image it
// shows is a file already sitting in a folder the user pointed at, served
// read-only; these bytes are ours, which means they answer to the same
// lifecycle every other sidecar does — they go on Clear, they go when the
// match goes, and they ride a profile move and a backup because they live in
// the database rather than beside it.
//
// They are CONTENT-ADDRESSED: the same screenshot attached to three moments
// is one row. That also makes the reference stable under a match rename,
// which a filename would not be.

var onePixelPNG = []byte{
	0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a,
	0x00, 0x00, 0x00, 0x0d, 'I', 'H', 'D', 'R',
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
	0x00, 0x00, 0x00, 0x0a, 'I', 'D', 'A', 'T',
	0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01,
	0x0d, 0x0a, 0x2d, 0xb4,
	0x00, 0x00, 0x00, 0x00, 'I', 'E', 'N', 'D', 0xae, 0x42, 0x60, 0x82,
}

func putImage(t *testing.T, s db.Store, raw []byte) string {
	t.Helper()
	sha, err := s.PutMomentImage(raw, "image/png")
	if err != nil {
		t.Fatalf("put image: %v", err)
	}
	return sha
}

func TestMomentImages_SameBytesAreOneRow(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			first := putImage(t, s, onePixelPNG)
			second := putImage(t, s, onePixelPNG)
			if first != second {
				t.Fatalf("same bytes hashed two ways: %q vs %q", first, second)
			}
			if first == "" {
				t.Fatal("empty digest")
			}
		})
	}
}

func TestMomentImages_RoundTripsBytesAndType(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			sha := putImage(t, s, onePixelPNG)

			got, ok, err := s.LoadMomentImage(sha)
			if err != nil {
				t.Fatalf("load: %v", err)
			}
			if !ok {
				t.Fatal("stored image not found")
			}
			if !bytes.Equal(got.Bytes, onePixelPNG) {
				t.Fatalf("bytes round-tripped wrong: %d bytes back, %d in", len(got.Bytes), len(onePixelPNG))
			}
			if got.MIME != "image/png" {
				t.Fatalf("MIME = %q, want image/png", got.MIME)
			}
			if got.ByteSize != len(onePixelPNG) {
				t.Fatalf("ByteSize = %d, want %d", got.ByteSize, len(onePixelPNG))
			}
		})
	}
}

func TestMomentImages_UnknownDigestIsNotAnError(t *testing.T) {
	// A dangling reference renders as a missing image, not as a failure — the
	// alternative is a 500 on a note somebody can still read.
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			_, ok, err := s.LoadMomentImage("nothing-was-ever-stored-here")
			if err != nil {
				t.Fatalf("load unknown: %v", err)
			}
			if ok {
				t.Fatal("reported an image that was never stored")
			}
		})
	}
}

func TestMomentImages_RefusesATypeItCannotServe(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			if _, err := s.PutMomentImage(onePixelPNG, "application/zip"); err == nil {
				t.Fatal("stored an image type the handler cannot serve")
			}
		})
	}
}

func TestMomentImages_AttachToAMomentAndComeBackWithIt(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			sha := putImage(t, s, onePixelPNG)

			m := moment("a", "m1", "03:23", "walked in alone")
			m.ImageSHA256 = sha
			if _, err := s.UpsertMatchMoment(m); err != nil {
				t.Fatalf("upsert: %v", err)
			}

			all, err := s.LoadMatchMoments()
			if err != nil {
				t.Fatalf("load moments: %v", err)
			}
			got := all["m1"]
			if len(got) != 1 {
				t.Fatalf("moments = %d, want 1", len(got))
			}
			if got[0].ImageSHA256 != sha {
				t.Fatalf("ImageSHA256 = %q, want %q", got[0].ImageSHA256, sha)
			}
		})
	}
}

func TestMomentImages_PruneKeepsWhatIsStillPointedAt(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			kept := putImage(t, s, onePixelPNG)
			orphan := putImage(t, s, append([]byte{0x89, 'P', 'N', 'G'}, 0x0d, 0x0a, 0x1a, 0x0a, 0x99))

			m := moment("a", "m1", "03:23", "still here")
			m.ImageSHA256 = kept
			if _, err := s.UpsertMatchMoment(m); err != nil {
				t.Fatalf("upsert: %v", err)
			}

			n, err := s.PruneOrphanMomentImages(0)
			if err != nil {
				t.Fatalf("prune: %v", err)
			}
			if n != 1 {
				t.Fatalf("pruned %d, want 1", n)
			}
			if _, ok, _ := s.LoadMomentImage(kept); !ok {
				t.Fatal("pruned an image a moment still points at")
			}
			if _, ok, _ := s.LoadMomentImage(orphan); ok {
				t.Fatal("kept an image nothing points at")
			}
		})
	}
}

func TestMomentImages_GoWhenTheMatchGoes(t *testing.T) {
	// HardDeleteMatch drops the moment; the bytes are then unreferenced and a
	// prune collects them. Deleting the match must not leave its screenshots
	// sitting in the database forever.
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			sha := putImage(t, s, onePixelPNG)
			m := moment("a", "m1", "03:23", "about to go")
			m.ImageSHA256 = sha
			if _, err := s.UpsertMatchMoment(m); err != nil {
				t.Fatalf("upsert: %v", err)
			}

			if err := s.HardDeleteMatch("m1"); err != nil {
				t.Fatalf("hard delete: %v", err)
			}
			if _, err := s.PruneOrphanMomentImages(0); err != nil {
				t.Fatalf("prune: %v", err)
			}
			if _, ok, _ := s.LoadMomentImage(sha); ok {
				t.Fatal("the deleted match's image survived")
			}
		})
	}
}

func TestMomentImages_ClearTakesThemToo(t *testing.T) {
	// The omission class this repo has paid for twice: a Clear that forgets a
	// sidecar, identically in both implementations, so every contract test
	// still passes.
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			sha := putImage(t, s, onePixelPNG)
			if err := s.Clear(); err != nil {
				t.Fatalf("clear: %v", err)
			}
			if _, ok, _ := s.LoadMomentImage(sha); ok {
				t.Fatal("Clear left an image behind")
			}
		})
	}
}

func TestMomentImages_PruneSparesWhatWasJustUploaded(t *testing.T) {
	// An upload happens BEFORE the moment that will name it is saved. Between
	// those two, the bytes have no referrer at all — and an unrelated delete
	// in that window must not take a frame somebody is still attaching.
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			sha := putImage(t, s, onePixelPNG)

			n, err := s.PruneOrphanMomentImages(time.Hour)
			if err != nil {
				t.Fatalf("prune: %v", err)
			}
			if n != 0 {
				t.Fatalf("pruned %d freshly uploaded images, want 0", n)
			}
			if _, ok, _ := s.LoadMomentImage(sha); !ok {
				t.Fatal("collected a frame that was still being attached")
			}
		})
	}
}

func TestMomentImages_PruneIsNotFooledByMomentsWithoutPictures(t *testing.T) {
	// The subqueries filter `image_sha256 IS NOT NULL` for a reason: in SQL,
	// `x NOT IN (…, NULL)` is never true, so one picture-less moment — which
	// is the NORMAL case, not an edge one — would make the sweep delete
	// nothing, ever. This is the shape that guard protects.
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			orphan := putImage(t, s, onePixelPNG)
			if _, err := s.UpsertMatchMoment(moment("plain", "m1", "01:00", "no picture here")); err != nil {
				t.Fatalf("upsert: %v", err)
			}

			n, err := s.PruneOrphanMomentImages(0)
			if err != nil {
				t.Fatalf("prune: %v", err)
			}
			if n != 1 {
				t.Fatalf("pruned %d, want 1 — a moment with no picture must not shield every orphan", n)
			}
			if _, ok, _ := s.LoadMomentImage(orphan); ok {
				t.Fatal("the orphan survived a sweep alongside a picture-less moment")
			}
		})
	}
}
