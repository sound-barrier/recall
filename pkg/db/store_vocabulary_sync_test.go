package db_test

import (
	"errors"
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"

	"recall/pkg/coach"
	"recall/pkg/db"
	"recall/pkg/db/dbtest"
	"recall/pkg/matchedit"
)

// Four closed vocabularies shipped without a CHECK while their own siblings
// carried one — summary/rank `result`, teams `queue_type`, and the coach
// moment's `focus_tag`, against user_match_data.result, match_queue.queue_type
// and the other five focus-tag tables.
//
// The OCR path cannot produce a bad value: the parsers emit the canonical
// strings and nothing else. The IMPORT path can. bundle.Import goes through
// Read(), a filename check, and then straight into the upserts, so a
// hand-edited data.json carrying `result: 'Victory'` lands intact — and the
// dossier's tallies are exact-equality, so that match then counts as neither a
// win nor a played game. It leaves the numerator and the denominator at once.
func TestSchema_RefusesAValueOutsideAClosedVocabulary(t *testing.T) {
	cases := []struct {
		name  string
		write func(s *db.SQLStore) error
	}{
		{"summary result", func(s *db.SQLStore) error {
			return s.UpsertSummary(db.SummaryRow{Filename: "s.png", MatchKey: "m1", Result: "Victory"})
		}},
		{"rank result", func(s *db.SQLStore) error {
			return s.UpsertRank(db.RankRow{Filename: "r.png", MatchKey: "m1", Rank: "platinum", Result: "Victory"})
		}},
		{"teams queue_type", func(s *db.SQLStore) error {
			return s.UpsertTeams(db.TeamsRow{Filename: "t.png", MatchKey: "m1", QueueType: "solo"})
		}},
		{"coach moment focus_tag", func(s *db.SQLStore) error {
			_, err := s.UpsertMatchCoachNote(db.MatchCoachNote{
				NoteID: "n1", MatchKey: "m1", CoachName: "Ordo", SessionDate: "2026-08-19", Text: "watch this",
				Moments: []db.MatchCoachNoteMoment{
					{MomentID: "mo1", MatchClock: "04:10", Text: "here", FocusTag: "vibes"},
				},
			})
			return err
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := tc.write(openMemory(t)); err == nil {
				t.Fatal("a value outside the vocabulary was accepted; the tallies that read it are exact-equality")
			}
		})
	}
}

// checkVocabRe pulls the quoted list out of every `CHECK (<col> IN ( ... ))`
// block for one column name, across the whole schema.
func schemaVocabularies(t *testing.T, column string) [][]string {
	t.Helper()
	raw, err := os.ReadFile("schema.sql")
	if err != nil {
		t.Fatalf("read schema.sql: %v", err)
	}
	// \b anchors the name: an unanchored `tag` also matches `focus_tag`.
	re := regexp.MustCompile(`(?s)\b` + column + ` IN \((.*?)\)`)
	var out [][]string
	for _, b := range re.FindAllStringSubmatch(string(raw), -1) {
		var got []string
		for _, m := range quotedRe.FindAllStringSubmatch(b[1], -1) {
			if m[1] != "" { // '' means "not set", not a vocabulary member
				got = append(got, m[1])
			}
		}
		slices.Sort(got)
		out = append(out, got)
	}
	return out
}

// Every copy of a vocabulary says the same thing. Comments asking two lists to
// stay in sync are what let "winning trend" drift out of the modifier CHECK
// and discard whole rank rows; these vocabularies get the test instead.
func TestSchemaVocabularies_EveryCopyAgrees(t *testing.T) {
	for _, tc := range []struct {
		column string
		want   []string
		copies int
	}{
		{"result", []string{"draw", "defeat", "victory"}, 3},
		{"queue_type", []string{"open", "role"}, 2},
		{"play_mode", []string{"competitive", "quickplay"}, 1},
	} {
		t.Run(tc.column, func(t *testing.T) {
			blocks := schemaVocabularies(t, tc.column)
			if len(blocks) != tc.copies {
				t.Fatalf("found %d %s CHECK blocks, want %d — a table gained or lost one, "+
					"and this test must learn about it rather than silently cover less",
					len(blocks), tc.column, tc.copies)
			}
			want := slices.Clone(tc.want)
			slices.Sort(want)
			for i, got := range blocks {
				if !slices.Equal(got, want) {
					t.Errorf("%s CHECK block %d = [%s], want [%s]",
						tc.column, i+1, strings.Join(got, ", "), strings.Join(want, ", "))
				}
			}
		})
	}
}

// The focus vocabulary has seven copies in the schema and two in Go. One list,
// so a player and their coach describe the same game in the same words — and
// so a tag cannot escape through GET /matches in violation of the
// CoachFocusTagEnum the API publishes.
func TestFocusTagVocabulary_SchemaAndGoAgree(t *testing.T) {
	want := slices.Clone(coach.FocusTags)
	slices.Sort(want)

	mine := slices.Clone(matchedit.FocusTags)
	slices.Sort(mine)
	if !slices.Equal(mine, want) {
		t.Errorf("matchedit.FocusTags = %v, want coach.FocusTags %v — a player and their "+
			"coach must file a game under the same words", mine, want)
	}

	// Three `focus_tag` columns and four `tag` child tables.
	const wantCopies = 7
	blocks := append(schemaVocabularies(t, "focus_tag"), schemaVocabularies(t, "tag")...)
	if len(blocks) != wantCopies {
		t.Fatalf("found %d focus-tag CHECK blocks in schema.sql, want %d", len(blocks), wantCopies)
	}
	for i, got := range blocks {
		if !slices.Equal(got, want) {
			t.Errorf("focus-tag CHECK block %d = [%s], want [%s]",
				i+1, strings.Join(got, ", "), strings.Join(want, ", "))
		}
	}
}

// The Fake stands in for the store in every pkg/app test, so it has to accept
// exactly what production accepts. It used to carry its OWN copy of the focus
// vocabulary — a third list, compared against nothing. Dropping a tag from it
// failed no test in the whole suite, and a Fake that refuses a tag production
// writes happily fails every caller with an error pointing at the wrong layer.
// It now asks coach.IsFocusTag; this is the test that says it must keep asking.
func TestFocusTagVocabulary_FakeAcceptsWhatProductionAccepts(t *testing.T) {
	// The tag check runs before the player lookup, so a tag the Fake accepts
	// falls through to the unknown-player refusal instead.
	for _, tag := range coach.FocusTags {
		_, err := dbtest.New().UpsertCoachNote(db.CoachNote{Kind: "note", FocusTags: []string{tag}})
		if !errors.Is(err, db.ErrCoachPlayerUnknown) {
			t.Errorf("focus tag %q: got %v, want it past the vocabulary check — the Fake "+
				"must accept every tag coach.FocusTags does", tag, err)
		}
	}

	_, err := dbtest.New().UpsertCoachNote(db.CoachNote{Kind: "note", FocusTags: []string{"not_a_tag"}})
	if err == nil || errors.Is(err, db.ErrCoachPlayerUnknown) {
		t.Errorf("the Fake let a tag outside the vocabulary through: %v", err)
	}
}
