package coachreturn_test

import (
	"errors"
	"testing"

	"recall/pkg/coach"
	"recall/pkg/coachreturn"
	"recall/pkg/db"
)

// A note about a replay names a key the player's machine has never minted.
// Binding it to the match they DO have — by the code both sides agree on —
// is the whole reason a coach can review without a bundle.
func TestStage_BindsAReplayNoteToTheMatchThatCarriesTheCode(t *testing.T) {
	fake := seededStore(t)
	fake.Annotations = map[string]db.Annotation{
		keyIlios: {MatchKey: keyIlios, ReplayCode: "A1B2C3"},
	}
	payload := notesArchive(t, replayNotesFile())

	sheet, _, err := coachreturn.Stage(fake, payload, "Sable", noMatchMaker)
	if err != nil {
		t.Fatalf("Stage: %v", err)
	}
	if len(sheet.Notes) != 1 {
		t.Fatalf("items = %d, want 1", len(sheet.Notes))
	}
	// The note reads as being about the player's own match, not about a key
	// that exists nowhere.
	if got := sheet.Notes[0].MatchKey; got != keyIlios {
		t.Errorf("MatchKey = %q, want it bound to %q", got, keyIlios)
	}
	if got := sheet.Notes[0].Status; got == coachreturn.StatusOrphan {
		t.Error("a bound note is not an orphan")
	}
}

// Nothing carries the code, so nothing binds — and that is NOT an orphan.
// An orphan is a note about a match that cannot be recovered; this one can,
// by creating it, which is what accept does.
func TestStage_AReplayNoteWithNoLocalMatchIsNotAnOrphan(t *testing.T) {
	fake := seededStore(t)
	payload := notesArchive(t, replayNotesFile())

	sheet, _, err := coachreturn.Stage(fake, payload, "Sable", noMatchMaker)
	if err != nil {
		t.Fatalf("Stage: %v", err)
	}
	if got := sheet.Notes[0].Status; got == coachreturn.StatusOrphan {
		t.Error("a replay note is never an orphan — accepting it creates the match")
	}
}

// The heal: a player who adds the code to their own match AFTER importing
// sees the note bind on the next read, with no re-import. That falls out of
// resolving at read time rather than rewriting the archive on the way in.
func TestGet_AnUnboundReplayNoteHealsWhenTheCodeArrivesLater(t *testing.T) {
	fake := seededStore(t)
	payload := notesArchive(t, replayNotesFile())

	staged, _, err := coachreturn.Stage(fake, payload, "Sable", noMatchMaker)
	if err != nil {
		t.Fatalf("Stage: %v", err)
	}
	if staged.Notes[0].MatchKey == keyIlios {
		t.Fatal("nothing carried the code yet; it must not be bound")
	}

	// The player annotates their own match with the code the coach watched.
	fake.Annotations = map[string]db.Annotation{
		keyIlios: {MatchKey: keyIlios, ReplayCode: "A1B2C3"},
	}

	healed, err := coachreturn.Get(fake, staged.ID, "Sable")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got := healed.Notes[0].MatchKey; got != keyIlios {
		t.Errorf("MatchKey = %q, want it to have bound to %q on re-read", got, keyIlios)
	}
}

// Accepting a bound note writes onto the PLAYER's key. Writing to the
// replay key would put the coach's words on a match nobody can see.
func TestDecide_AcceptsOntoTheBoundMatch(t *testing.T) {
	fake := seededStore(t)
	fake.Annotations = map[string]db.Annotation{
		keyIlios: {MatchKey: keyIlios, ReplayCode: "A1B2C3"},
	}
	payload := notesArchive(t, replayNotesFile())
	staged, _, err := coachreturn.Stage(fake, payload, "Sable", noMatchMaker)
	if err != nil {
		t.Fatalf("Stage: %v", err)
	}

	if _, err := coachreturn.Decide(fake, staged.ID, []coachreturn.Verdict{
		{NoteID: noteIDOne, Decision: coachreturn.DecisionAccepted},
	}, "Sable", noMatchMaker); err != nil {
		t.Fatalf("Decide: %v", err)
	}

	var landedOn []string
	for _, n := range fake.MatchCoachNotes {
		if n.NoteID == noteIDOne {
			landedOn = append(landedOn, n.MatchKey)
		}
	}
	if len(landedOn) != 1 || landedOn[0] != keyIlios {
		t.Errorf("the note landed on %v, want [%s]", landedOn, keyIlios)
	}
	if fake.Reviews[keyIlios].ReviewedBy != "coach" {
		t.Errorf("the bound match was not marked reviewed by coach")
	}
}

// Nothing local carries the code, so accepting has to MAKE the match — that
// is what "match on replay code, else create" means, and it happens on
// accept rather than on import so that discarding a return leaves nothing
// stranded.
func TestDecide_CreatesTheMatchWhenNothingCarriesTheCode(t *testing.T) {
	fake := seededStore(t)
	payload := notesArchive(t, replayNotesFile())
	staged, _, err := coachreturn.Stage(fake, payload, "Sable", noMatchMaker)
	if err != nil {
		t.Fatalf("Stage: %v", err)
	}

	made := map[string]coach.MatchContext{}
	maker := func(n coach.Note) (string, error) {
		made[n.MatchKey] = *n.Match
		return "replay-A1B2C3", nil
	}
	if _, err := coachreturn.Decide(fake, staged.ID, []coachreturn.Verdict{
		{NoteID: noteIDOne, Decision: coachreturn.DecisionAccepted},
	}, "Sable", maker); err != nil {
		t.Fatalf("Decide: %v", err)
	}
	if len(made) != 1 {
		t.Fatalf("the match was not created: %v", made)
	}
	// It is created from the context the COACH observed — the only thing
	// identifying a match the player has never seen.
	if made["replay-A1B2C3"].Map != "ilios" {
		t.Errorf("created from %+v, want the coach's observed context", made["replay-A1B2C3"])
	}
}

// Staging must not write. The preview a player reads before deciding
// anything cannot be the thing that changes their history — and it is what
// makes discarding a return clean, because there is nothing to strand.
func TestStage_CreatesNothing(t *testing.T) {
	fake := seededStore(t)
	payload := notesArchive(t, replayNotesFile())

	called := false
	maker := func(coach.Note) (string, error) { called = true; return "", nil }
	if _, _, err := coachreturn.Stage(fake, payload, "Sable", maker); err != nil {
		t.Fatalf("Stage: %v", err)
	}
	if called {
		t.Error("Stage created a match; only accept may")
	}
	if len(fake.UserMatchData) != 4 {
		t.Errorf("Stage wrote user-match rows: %d, want the 4 seeded", len(fake.UserMatchData))
	}
}

// An archive is a file from someone else, and maxNotesPerFile lets it carry
// five thousand notes. Every one about an unseen replay is a match this
// history would gain, so an "accept everything" on a careless or hostile
// file could fabricate a career. The batch refuses past a bound rather than
// creating what it is asked to.
func TestDecide_BoundsHowManyMatchesOneBatchCanCreate(t *testing.T) {
	fake := seededStore(t)
	f := validNotesFile()
	f.Notes = nil
	verdicts := make([]coachreturn.Verdict, 0, coachreturn.MaxCreatedPerBatch+1)
	for i := 0; i <= coachreturn.MaxCreatedPerBatch; i++ {
		code := replayCodeForIndex(i)
		id := noteIDForIndex(i)
		f.Notes = append(f.Notes, coach.Note{
			NoteID: id, MatchKey: "replay-" + code, Kind: "note", Text: "x",
			FocusTags: []string{}, ExtraTags: []string{}, UpdatedAt: "2026-08-15T09:00:00Z",
			Match: &coach.MatchContext{ReplayCode: code},
		})
		verdicts = append(verdicts, coachreturn.Verdict{NoteID: id, Decision: coachreturn.DecisionAccepted})
	}
	staged, _, err := coachreturn.Stage(fake, notesArchive(t, f), "Sable", noMatchMaker)
	if err != nil {
		t.Fatalf("Stage: %v", err)
	}

	created := 0
	maker := func(n coach.Note) (string, error) {
		created++
		return n.MatchKey, nil
	}
	if _, err := coachreturn.Decide(fake, staged.ID, verdicts, "Sable", maker); !errors.Is(err, coachreturn.ErrTooManyCreated) {
		t.Fatalf("err = %v, want ErrTooManyCreated", err)
	}
	// Refused whole: the batch is validated before anything is written, so
	// a rejected batch leaves no half-made history behind.
	if created != 0 {
		t.Errorf("created %d matches before refusing; want 0", created)
	}
}
