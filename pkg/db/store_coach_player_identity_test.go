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
			first, err := s.EnsureCoachPlayer("", "Aria", db.CoachKindPlayer)
			mustNoErr(t, err)
			mustNoErr(t, s.RenameCoachPlayer(first.ID, "Aria-elsewhere"))
			second, err := s.EnsureCoachPlayer("", "Aria", db.CoachKindPlayer)
			mustNoErr(t, err)
			mustNoErr(t, s.RenameCoachPlayer(first.ID, "Aria"))
			if first.ID == second.ID {
				t.Fatalf("fixture failed to make two rows: %d", first.ID)
			}

			_, err = s.EnsureCoachPlayer("uuid-b", "Aria", db.CoachKindPlayer)

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
			anon, err := s.EnsureCoachPlayer("", "Aria", db.CoachKindPlayer)
			mustNoErr(t, err)

			got, err := s.EnsureCoachPlayer("uuid-a", "Aria", db.CoachKindPlayer)
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

// A team is a roster row like any other — that is the whole trick that lets
// every per-player mechanism (notes, focus items, rehydration) carry a team
// review unchanged. But a team named Aria and a player named Aria are two
// different files of notes, so kind participates in the handle lookup.
func TestStoreContract_ATeamAndAPlayerShareAHandleAsTwoRows(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			player, err := s.EnsureCoachPlayer("", "Aria", db.CoachKindPlayer)
			mustNoErr(t, err)
			team, err := s.EnsureCoachPlayer("", "Aria", db.CoachKindTeam)
			mustNoErr(t, err)

			if player.ID == team.ID {
				t.Fatalf("one row %d serves both kinds — a team review would land in the player's file", player.ID)
			}
			if team.Kind != db.CoachKindTeam || player.Kind != db.CoachKindPlayer {
				t.Fatalf("kinds = %q/%q, want team/player", team.Kind, player.Kind)
			}

			again, err := s.EnsureCoachPlayer("", "Aria", db.CoachKindTeam)
			mustNoErr(t, err)
			if again.ID != team.ID {
				t.Fatalf("second team lookup = row %d, want the existing team row %d", again.ID, team.ID)
			}

			roster, err := s.LoadCoachPlayers()
			mustNoErr(t, err)
			kinds := map[int64]string{}
			for _, r := range roster {
				kinds[r.ID] = r.Kind
			}
			if kinds[team.ID] != db.CoachKindTeam || kinds[player.ID] != db.CoachKindPlayer {
				t.Fatalf("roster kinds = %v — the roster cannot mark TEAM rows without them", kinds)
			}
		})
	}
}

// Adoption — backfilling a bundle's player id onto a sole id-less row — is a
// player-only mechanism. A team row under the same handle must never swallow
// the backfill: that would attribute a whole team's shared review to one
// player, and the next export would hand it over under their name.
func TestStoreContract_AdoptionNeverPicksATeamRow(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			team, err := s.EnsureCoachPlayer("", "Aria", db.CoachKindTeam)
			mustNoErr(t, err)

			p, err := s.EnsureCoachPlayer("uuid-a", "Aria", db.CoachKindPlayer)
			mustNoErr(t, err)

			if p.ID == team.ID {
				t.Fatalf("the id backfill adopted the TEAM row %d", team.ID)
			}
			if p.Kind != db.CoachKindPlayer || p.PlayerID != "uuid-a" {
				t.Fatalf("adopted row = %+v, want a fresh identified player", p)
			}
		})
	}
}
