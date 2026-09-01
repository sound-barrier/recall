package bundle_test

import (
	"bytes"
	"testing"

	"recall/pkg/bundle"
	"recall/pkg/db"
	"recall/pkg/db/dbtest"
)

// A bundle is the one carrier that is NOT the database.
//
// A profile move, a backup and a restore all move the file the bytes live in,
// so an attachment rides along without anyone teaching them. The bundle
// serializes rows instead — so without these entries, every moment lands on
// the far side naming a digest that database has never seen, and the frame is
// silently gone. It is exactly the carrier the custody design nearly missed.

var pixel = []byte{
	0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a,
	0x00, 0x00, 0x00, 0x0d, 'I', 'H', 'D', 'R',
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
	0x00, 0x00, 0x00, 0x0a, 'I', 'D', 'A', 'T',
	0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01,
	0x0d, 0x0a, 0x2d, 0xb4,
	0x00, 0x00, 0x00, 0x00, 'I', 'E', 'N', 'D', 0xae, 0x42, 0x60, 0x82,
}

func TestBundle_CarriesTheFrameAMomentNames(t *testing.T) {
	shots := t.TempDir()
	src := seededStore(t, shots)
	writeShots(t, shots, seededParentFiles()...)

	sha, err := src.PutMomentImage(pixel, "image/png")
	if err != nil {
		t.Fatalf("put image: %v", err)
	}
	if _, err := src.UpsertMatchMoment(db.MatchMoment{
		MomentID: "m-1", MatchKey: "m1", MatchClock: "03:23",
		Text: "walked in alone", ImageSHA256: sha,
	}); err != nil {
		t.Fatalf("upsert moment: %v", err)
	}

	payload, err := bundle.Export(src, bundle.ExportBundleOptions{MatchKeys: seededKeys()}, nil, shots, seededVersion)
	if err != nil {
		t.Fatalf("Export: %v", err)
	}

	// A fresh database on the far side — the whole point is that it has never
	// seen these bytes.
	dst := dbtest.New()
	if _, err := bundle.Import(dst, payload); err != nil {
		t.Fatalf("Import: %v", err)
	}

	img, ok, err := dst.LoadMomentImage(sha)
	if err != nil || !ok {
		t.Fatal("the moment arrived but its frame did not")
	}
	if !bytes.Equal(img.Bytes, pixel) {
		t.Fatalf("frame came back wrong: %d bytes", len(img.Bytes))
	}

	assertMomentPointsAt(t, dst, sha)
}

// assertMomentPointsAt keeps the round-trip case under the complexity gate:
// the reference check is its own question from the bytes check above it.
func assertMomentPointsAt(t *testing.T, store *dbtest.Fake, sha string) {
	t.Helper()
	moments, err := store.LoadMatchMoments()
	if err != nil {
		t.Fatalf("load moments: %v", err)
	}
	if len(moments["m1"]) != 1 || moments["m1"][0].ImageSHA256 != sha {
		t.Fatalf("the imported moment does not point at the frame: %+v", moments["m1"])
	}
}

func TestBundle_ExportsWithoutTheFrameRatherThanFailing(t *testing.T) {
	// A picture can be pruned between being attached and the history being
	// exported. Refusing to export a whole history over one missing frame is
	// the worse trade — the far side already treats an unresolvable reference
	// as a missing picture.
	shots := t.TempDir()
	src := seededStore(t, shots)
	writeShots(t, shots, seededParentFiles()...)
	if _, err := src.UpsertMatchMoment(db.MatchMoment{
		MomentID: "m-1", MatchKey: "m1", MatchClock: "03:23",
		Text: "the frame is gone", ImageSHA256: db.MomentImageDigest(pixel),
	}); err != nil {
		t.Fatalf("upsert moment: %v", err)
	}

	if _, err := bundle.Export(src, bundle.ExportBundleOptions{MatchKeys: seededKeys()}, nil, shots, seededVersion); err != nil {
		t.Fatalf("Export refused a history over one missing frame: %v", err)
	}
}
