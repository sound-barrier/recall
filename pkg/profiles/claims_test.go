package profiles_test

import (
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

// Seeding runs once: the first call imports every profile's existing
// screenshots (earliest ingest wins a hash two profiles share), and a second
// call is a no-op even if the inputs changed.
func TestClaims_SeedOnceEarliestWins(t *testing.T) {
	c := openClaims(t, t.TempDir())
	seed := []profiles.SeedClaim{
		{Hash: "h1", Profile: "alt", Filename: "a.png", IngestedAt: "2026-05-02T00:00:00Z"},
		{Hash: "h1", Profile: "main", Filename: "a.png", IngestedAt: "2026-05-01T00:00:00Z"},
		{Hash: "h2", Profile: "alt", Filename: "b.png", IngestedAt: "2026-05-03T00:00:00Z"},
	}
	seeded, err := c.SeedOnce(seed)
	mustNoErr(t, err)
	if !seeded {
		t.Fatal("first SeedOnce reported no seeding")
	}
	assertOwner(t, c, "h1", "main")
	assertOwner(t, c, "h2", "alt")

	seeded, err = c.SeedOnce([]profiles.SeedClaim{{Hash: "h3", Profile: "main", Filename: "c.png"}})
	mustNoErr(t, err)
	if seeded {
		t.Fatal("second SeedOnce seeded again")
	}
	assertOwner(t, c, "h3", "")
}
