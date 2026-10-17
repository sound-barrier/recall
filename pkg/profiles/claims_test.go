package profiles_test

import (
	"errors"
	"testing"

	"recall/pkg/profiles"
)

// A screenshot belongs to the first profile that parses it. These tests pin the
// shared claims ledger that enforces that across profiles: who owns a hash,
// when a claim can be taken over, and that it survives a reopen.

func openClaims(t *testing.T, base string) *profiles.Claims {
	t.Helper()
	c, err := profiles.OpenClaims(base)
	mustNoErr(t, err)
	t.Cleanup(func() { _ = c.Close() })
	return c
}

func assertOwner(t *testing.T, c *profiles.Claims, hash, want string) {
	t.Helper()
	got, err := c.OwnerOf(hash)
	mustNoErr(t, err)
	if got != want {
		t.Fatalf("OwnerOf(%q) = %q, want %q", hash, got, want)
	}
}

func TestClaims_FirstClaimWins(t *testing.T) {
	c := openClaims(t, t.TempDir())

	owner, err := c.Claim("h1", "main", "a.png")
	mustNoErr(t, err)
	if owner != "main" {
		t.Fatalf("first claim owner = %q, want main", owner)
	}
	owner, err = c.Claim("h1", "alt", "a.png")
	mustNoErr(t, err)
	if owner != "main" {
		t.Fatalf("second claim owner = %q, want main (claim must not move)", owner)
	}
	assertOwner(t, c, "h1", "main")
}

func TestClaims_UnclaimedHashHasNoOwner(t *testing.T) {
	c := openClaims(t, t.TempDir())
	assertOwner(t, c, "nope", "")
}

func TestClaims_ReleaseOnlyByOwner(t *testing.T) {
	c := openClaims(t, t.TempDir())
	_, err := c.Claim("h1", "main", "a.png")
	mustNoErr(t, err)

	mustNoErr(t, c.Release("h1", "alt"))
	assertOwner(t, c, "h1", "main")

	mustNoErr(t, c.Release("h1", "main"))
	assertOwner(t, c, "h1", "")
}

func TestClaims_TransferMovesOwnership(t *testing.T) {
	c := openClaims(t, t.TempDir())
	_, err := c.Claim("h1", "main", "a.png")
	mustNoErr(t, err)

	mustNoErr(t, c.Transfer("h1", "alt", "a.png"))
	assertOwner(t, c, "h1", "alt")

	// Transferring an unclaimed hash claims it for the target.
	mustNoErr(t, c.Transfer("h2", "alt", "b.png"))
	assertOwner(t, c, "h2", "alt")
}

func TestClaims_OwnedByOthers(t *testing.T) {
	c := openClaims(t, t.TempDir())
	for hash, profile := range map[string]string{"h1": "main", "h2": "alt", "h3": "alt"} {
		_, err := c.Claim(hash, profile, hash+".png")
		mustNoErr(t, err)
	}

	got, err := c.OwnedByOthers("main")
	mustNoErr(t, err)
	if len(got) != 2 || !got["h2"] || !got["h3"] || got["h1"] {
		t.Fatalf("OwnedByOthers(main) = %v, want {h2, h3}", got)
	}
}

func TestClaims_RenameProfileKeepsItsClaims(t *testing.T) {
	c := openClaims(t, t.TempDir())
	_, err := c.Claim("h1", "main", "a.png")
	mustNoErr(t, err)

	mustNoErr(t, c.RenameProfile("main", "ranked"))
	assertOwner(t, c, "h1", "ranked")
}

func TestClaims_PersistAcrossReopen(t *testing.T) {
	base := t.TempDir()
	c, err := profiles.OpenClaims(base)
	mustNoErr(t, err)
	_, err = c.Claim("h1", "main", "a.png")
	mustNoErr(t, err)
	mustNoErr(t, c.Close())

	assertOwner(t, openClaims(t, base), "h1", "main")
}

// Sightings cache each profile's hash of a file path, so a profile hashes a
// screenshot once rather than on every pending-count refresh.
func TestClaims_SightingsArePerProfileAndFollowRenames(t *testing.T) {
	c := openClaims(t, t.TempDir())
	mustNoErr(t, c.RecordSighting("main", "/ow/a.png", "h1"))

	main, err := c.Sightings("main")
	mustNoErr(t, err)
	if main["/ow/a.png"] != "h1" {
		t.Fatalf("Sightings(main) = %v, want /ow/a.png -> h1", main)
	}
	alt, err := c.Sightings("alt")
	mustNoErr(t, err)
	if len(alt) != 0 {
		t.Fatalf("Sightings(alt) = %v, want none", alt)
	}

	mustNoErr(t, c.RecordSighting("main", "/ow/a.png", "h2"))
	mustNoErr(t, c.RenameProfile("main", "ranked"))
	ranked, err := c.Sightings("ranked")
	mustNoErr(t, err)
	if ranked["/ow/a.png"] != "h2" {
		t.Fatalf("Sightings(ranked) = %v, want the re-recorded hash under the new name", ranked)
	}
}

// Seeding runs once: the first call imports every profile's existing
// screenshots (earliest ingest wins a hash two profiles share), and a later
// call neither seeds again nor even asks for the inputs.
func TestClaims_SeedOnceEarliestWins(t *testing.T) {
	c := openClaims(t, t.TempDir())
	seed := []profiles.SeedClaim{
		{Hash: "h1", Profile: "alt", Filename: "a.png", IngestedAt: "2026-05-02T00:00:00Z"},
		{Hash: "h1", Profile: "main", Filename: "a.png", IngestedAt: "2026-05-01T00:00:00Z"},
		{Hash: "h2", Profile: "alt", Filename: "b.png", IngestedAt: "2026-05-03T00:00:00Z"},
	}
	seeded, err := c.SeedOnce(func() ([]profiles.SeedClaim, error) { return seed, nil })
	mustNoErr(t, err)
	if !seeded {
		t.Fatal("first SeedOnce reported no seeding")
	}
	assertOwner(t, c, "h1", "main")
	assertOwner(t, c, "h2", "alt")

	asked := false
	seeded, err = c.SeedOnce(func() ([]profiles.SeedClaim, error) {
		asked = true
		return []profiles.SeedClaim{{Hash: "h3", Profile: "main", Filename: "c.png"}}, nil
	})
	mustNoErr(t, err)
	if seeded || asked {
		t.Fatalf("second SeedOnce: seeded=%v asked=%v, want neither", seeded, asked)
	}
	assertOwner(t, c, "h3", "")
}

// A failed load leaves the ledger unseeded, so the next start tries again.
func TestClaims_SeedOnceRetriesAfterALoadFailure(t *testing.T) {
	c := openClaims(t, t.TempDir())
	_, err := c.SeedOnce(func() ([]profiles.SeedClaim, error) { return nil, errors.New("disk on fire") })
	if err == nil {
		t.Fatal("SeedOnce swallowed the load error")
	}
	seeded, err := c.SeedOnce(func() ([]profiles.SeedClaim, error) {
		return []profiles.SeedClaim{{Hash: "h1", Profile: "main", Filename: "a.png"}}, nil
	})
	mustNoErr(t, err)
	if !seeded {
		t.Fatal("SeedOnce did not retry after a failed load")
	}
	assertOwner(t, c, "h1", "main")
}

// A screenshot that predates the registry has no ingest time; a profile with
// a dated ingest of the same bytes is the better evidence and wins.
func TestClaims_SeedOnceDatedIngestBeatsUndated(t *testing.T) {
	c := openClaims(t, t.TempDir())
	_, err := c.SeedOnce(func() ([]profiles.SeedClaim, error) {
		return []profiles.SeedClaim{
			{Hash: "h1", Profile: "legacy", Filename: "a.png"},
			{Hash: "h1", Profile: "main", Filename: "a.png", IngestedAt: "2026-05-01T00:00:00Z"},
		}, nil
	})
	mustNoErr(t, err)
	assertOwner(t, c, "h1", "main")
}
