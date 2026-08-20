package db_test

import (
	"errors"
	"testing"

	"recall/pkg/db"
)

// coach_players.handle is NOT unique — it cannot be, because two people
// genuinely do use the same name — and identity falls back to it when a
// bundle carries no player id. The fallback used to be
// `WHERE handle = ? AND player_id IS NULL ORDER BY id LIMIT 1`, and the
// ORDER BY was the admission: the predicate can match more than one row, and
// it picked one.
//
// What it picks is not a display detail. Adopting a row backfills the
// incoming player's UUID onto it, so THEIR notes become the other player's —
// and the next share-back export hands one player the other's coaching notes.
func TestStoreContract_TwoIdlessPlayersOnOneHandleAreNotGuessedBetween(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			// Two anonymous archives, both from someone calling themselves Aria.
			// (An anonymous lookup takes the earliest match, so they are made
			// distinct by renaming the first out of the way and back.)
			first, err := s.EnsureCoachPlayer("", "Aria")
			mustNoErr(t, err)
			mustNoErr(t, s.RenameCoachPlayer(first.ID, "Aria-elsewhere"))
			second, err := s.EnsureCoachPlayer("", "Aria")
			mustNoErr(t, err)
			mustNoErr(t, s.RenameCoachPlayer(first.ID, "Aria"))
			if first.ID == second.ID {
				t.Fatalf("fixture failed to make two rows: %d", first.ID)
			}

			_, err = s.EnsureCoachPlayer("uuid-b", "Aria")

			if !errors.Is(err, db.ErrCoachHandleAmbiguous) {
				t.Fatalf("EnsureCoachPlayer = %v, want ErrCoachHandleAmbiguous — "+
					"picking one attributes the other's notes to this player", err)
			}
		})
	}
}

// The legitimate case is untouched: ONE id-less row under that handle is the
// same player, upgrading from an archive that predates the player identity.
// It still adopts, and keeps its notes.
func TestStoreContract_ASingleIdlessRowIsStillAdopted(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			anon, err := s.EnsureCoachPlayer("", "Aria")
			mustNoErr(t, err)

			got, err := s.EnsureCoachPlayer("uuid-a", "Aria")
			mustNoErr(t, err)

			if got.ID != anon.ID {
				t.Errorf("row = %d, want the existing %d — the same player upgrading must keep their notes",
					got.ID, anon.ID)
			}
			if got.PlayerID != "uuid-a" {
				t.Errorf("player_id = %q, want it backfilled to uuid-a", got.PlayerID)
			}
		})
	}
}
