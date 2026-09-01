package app_test

import (
	"errors"
	"maps"
	"reflect"
	"strings"
	"testing"

	"recall/pkg/app"
	"recall/pkg/coach"
	"recall/pkg/db"
	"recall/pkg/db/dbtest"
	"recall/pkg/match"
	"recall/pkg/matchedit"
	"recall/pkg/review"
)

// The write gate (design rule 1): while a coaching session is open the
// coach's own database is frozen. These three tables enumerate every
// mutating orchestrator on *App, and the reflection net below proves the
// tables are complete — a new orchestrator shipped without the gate fails
// here rather than silently writing through a session.

// gatedPerMatchWrites are the per-match sidecar writers.
func gatedPerMatchWrites(a *app.App) map[string]func() error {
	return map[string]func() error{
		"SetMatchAnnotation": func() error { return a.SetMatchAnnotation(app.AnnotationInput{MatchKey: "k", Note: "n"}) },
		"SetMatchMoment": func() error {
			_, err := a.SetMatchMoment("k", "", matchedit.MomentInput{MatchClock: "4:45", Text: "x"})
			return err
		},
		"DeleteMatchMoment":     func() error { return a.DeleteMatchMoment("k", "m") },
		"DeleteMatchAnnotation": func() error { return a.DeleteMatchAnnotation("k") },
		"SetMatchReview":        func() error { return a.SetMatchReview("k", "self") },
		"ClearMatchReview":      func() error { return a.ClearMatchReview("k") },
		"SetMatchQueue":         func() error { return a.SetMatchQueue("k", "role") },
		"ClearMatchQueue":       func() error { return a.ClearMatchQueue("k") },
		"BulkSetMatchQueue":     func() error { return a.BulkSetMatchQueue([]string{"k"}, "role") },
		"SetMatchPlayMode":      func() error { return a.SetMatchPlayMode("k", "competitive") },
		"ClearMatchPlayMode":    func() error { return a.ClearMatchPlayMode("k") },
		"BulkSetMatchPlayMode":  func() error { return a.BulkSetMatchPlayMode([]string{"k"}, "competitive") },
		"HideMatch":             func() error { return a.HideMatch("k") },
		"UnhideMatch":           func() error { return a.UnhideMatch("k") },
		"PinMatch":              func() error { return a.PinMatch("k") },
		"UnpinMatch":            func() error { return a.UnpinMatch("k") },
		"AcknowledgeReferenceGap": func() error {
			return a.AcknowledgeReferenceGap("k")
		},
		"UnacknowledgeReferenceGap": func() error {
			return a.UnacknowledgeReferenceGap("k")
		},
		"HardDeleteMatch": func() error { return a.HardDeleteMatch("k") },
	}
}

// gatedCorpusWrites are the whole-corpus and match-identity writers.
func gatedCorpusWrites(a *app.App) map[string]func() error {
	return map[string]func() error{
		"UpdateMatchData": func() error { return a.UpdateMatchData("k", match.UserMatchDataInput{}) },
		"ResetMatchData":  func() error { return a.ResetMatchData("k") },
		"CreateManualMatch": func() error {
			_, err := a.CreateManualMatch(match.ManualMatchInput{Map: "rialto", Result: "victory"})
			return err
		},
		"ClearDatabase": func() error { return a.ClearDatabase(false) },
		"ResolveAmbiguousMatch": func() error {
			return a.ResolveAmbiguousMatch(match.NewAmbiguousMatchKey("stray.png").String(), playerMatchRialto)
		},
		"MoveMatches": func() error { return a.MoveMatches([]string{"k"}, "other") },
	}
}

// gatedIngestWrites are the entry points that bring new data in or replace
// what is there, plus the ignore list that decides what a parse ingests and
// the player-side accept path that writes the received coach layer.
func gatedIngestWrites(a *app.App) map[string]func() error {
	return map[string]func() error{
		"StartParse":       func() error { return a.StartParse(false) },
		"ParseScreenshots": a.ParseScreenshots,
		"ReParseAll":       a.ReParseAll,
		"ImportMatches": func() error {
			_, err := a.ImportMatches([]byte("{}"))
			return err
		},
		"RestoreDatabase":         func() error { return a.RestoreDatabase([]byte("{}")) },
		"IgnoreScreenshot":        func() error { return a.IgnoreScreenshot("x.png") },
		"UnignoreScreenshot":      func() error { return a.UnignoreScreenshot("x.png") },
		"RetryFailedFile":         func() error { return a.RetryFailedFile("x.png") },
		"ClearIgnoredScreenshots": a.ClearIgnoredScreenshots,
		"SeedTestProfile": func() error {
			_, err := a.SeedTestProfile()
			return err
		},
		"DecideCoachReturn": func() error {
			_, err := a.DecideCoachReturn(1, nil)
			return err
		},
		"DeleteCoachReturn":    func() error { return a.DeleteCoachReturn(1) },
		"DeleteMatchCoachNote": func() error { return a.DeleteMatchCoachNote("k", 1) },
	}
}

// gatedSelfReviewWrites are the player's own saved-sitting writers. A self
// review is the player's data, so a coach session (someone else's data on
// the same machine) freezes it like every other write.
func gatedSelfReviewWrites(a *app.App) map[string]func() error {
	return map[string]func() error{
		"CreateSelfReview": func() error {
			_, err := a.CreateSelfReview(review.CreateInput{MatchKeys: []string{"k"}})
			return err
		},
		"UpdateSelfReview": func() error {
			_, err := a.UpdateSelfReview("r", review.UpdateInput{Title: "t"})
			return err
		},
		"SetSelfReviewMatches": func() error {
			_, err := a.SetSelfReviewMatches("r", []string{"k"})
			return err
		},
		"DeleteSelfReview": func() error { return a.DeleteSelfReview("r") },
		"SetSelfReviewFocusItems": func() error {
			_, err := a.SetSelfReviewFocusItems("r", []db.FocusItem{{ItemID: coach.NewID(), Text: "t"}})
			return err
		},
		// The player's own list — a coach's items land in it, but moving one
		// is the player acting on their data, so the gate covers it.
		"SetFocusItemStatus": func() error { return a.SetFocusItemStatus("i", string(db.FocusWorking)) },
		// The saved roster is the PLAYER's list of people. A coach with a
		// loan open is looking at somebody else's history and must not
		// rename anybody in it.
		"SaveRosterMember": func() error {
			return a.SaveRosterMember(db.RosterMember{Tag: "Zed#2100", DisplayName: "Zed"})
		},
		"RemoveRosterMember": func() error { return a.RemoveRosterMember("Zed#2100") },
		"FinishSelfReview": func() error {
			_, err := a.FinishSelfReview("r")
			return err
		},
		"PutSelfReviewNote": func() error {
			_, err := a.PutSelfReviewNote("r", "k", coach.NoteInput{Kind: "note", Text: "x"})
			return err
		},
		"DeleteSelfReviewNote": func() error { return a.DeleteSelfReviewNote("r", "k") },
		"PutSelfReviewMoment": func() error {
			_, err := a.PutSelfReviewMoment("r", "k", "m", matchedit.MomentInput{MatchClock: "4:45", Text: "x"})
			return err
		},
		"DeleteSelfReviewMoment": func() error {
			return a.DeleteSelfReviewMoment("r", "k", "m")
		},
	}
}

// gatedWrites is the whole gate list — the union of the three groups.
func gatedWrites(a *app.App) map[string]func() error {
	all := gatedPerMatchWrites(a)
	maps.Copy(all, gatedCorpusWrites(a))
	maps.Copy(all, gatedIngestWrites(a))
	maps.Copy(all, gatedSelfReviewWrites(a))
	return all
}

// Every mutating orchestrator refuses while a session is open.
func TestCoachSession_EveryMutatingOrchestratorIsGated(t *testing.T) {
	a, _ := openSession(t)
	for name, call := range gatedWrites(a) {
		if err := call(); !errors.Is(err, coach.ErrSessionActive) {
			t.Errorf("%s during a session = %v, want coach.ErrSessionActive", name, err)
		}
	}
}

// The same calls fail on their own merits once the session is closed — the
// gate is state, not a permanent lock.
func TestCoachSession_GateLiftsOnClose(t *testing.T) {
	a, _ := openSession(t)
	mustNoErr(t, a.CloseCoachSession())
	for name, call := range gatedWrites(a) {
		if err := call(); errors.Is(err, coach.ErrSessionActive) {
			t.Errorf("%s after the session closed = %v, want the gate lifted", name, err)
		}
	}
}

// mutatingVerbs are the name prefixes that mark an App method as a candidate
// corpus mutation. The completeness net below holds every exported method
// starting with one of these to "gated, or exempt with a stated reason".
var mutatingVerbs = []string{
	"Acknowledge", "Add", "Apply", "Bulk", "Clear", "Create", "Delete", "Demote",
	"Finish", "Hide", "Ignore", "Import", "Move", "Parse", "Pin", "Promote",
	"Put", "ReParse", "Remove", "Rename", "Reset", "Resolve", "Restore",
	"Retry", "Seed", "Set", "Start", "Switch", "Unacknowledge", "Unhide",
	"Unignore", "Unpin", "Update",
}

// ungatedByDesign is every mutating-sounding App method the gate must NOT
// cover, each with the reason it is out of scope. Anything else must appear
// in gatedWrites.
var ungatedByDesign = map[string]string{
	"Startup":               "boot, not a user write",
	"StartupError":          "a read",
	"StartSelfUpdate":       "replaces the binary, not the data",
	"ApplyGameDataUpdate":   "rewrites the hero/map rosters on disk, not the store",
	"SetProfileOverride":    "records a CLI flag for the next boot",
	"SetScreenshotsDir":     "settings, not the corpus",
	"ResetScreenshotsDir":   "settings, not the corpus",
	"SetTesseractPath":      "settings, not the corpus",
	"ResetTesseractPath":    "settings, not the corpus",
	"SetWatchEnabled":       "settings, not the corpus",
	"SetExitOnClose":        "settings, not the corpus",
	"SetAutoBackupInterval": "settings, not the corpus",
	"SetCoachingSettings":   "settings, not the corpus",
	"SetCoachSessionPlayer": "the session's own surface",
	"PutCoachNote":          "the session's own surface — coach-authored, by design",
	"PutCoachFocusItems":    "the session's own surface — coach-authored, by design",
	"DeleteCoachNote":       "the session's own surface — coach-authored, by design",
	"PutCoachMoment":        "the session's own surface — coach-authored, by design",
	// Content-addressed bytes in the CALLER's own database. A coach attaching
	// a frame mid-session is storing it on their own disk, exactly as a player
	// does — there is no other player's corpus for the gate to protect, and
	// the moment that points at it IS gated on whichever side wrote it.
	"PutMomentImage": "stores bytes in the caller's own database; the moment referencing them is what the gate covers",
	// A sweep over rows nothing points at any more. It cannot remove anything
	// a moment still names, in either direction, so it is safe to run whoever
	// is at the keyboard.
	"PruneMomentImages": "collects unreferenced bytes; removes nothing any moment still names",
	"DeleteCoachMoment": "the session's own surface — coach-authored, by design",
	// Both write to the in-memory session and nothing else. The reel a coach
	// TYPED is theirs to grow, and what they observed while watching is
	// theirs to record; neither reaches a store, so there is no coach's own
	// history for the gate to protect. The session slot itself is still
	// exclusive — these refuse with ErrNoSession when none is open.
	"AddCoachSessionReplayCode":   "the session's own surface — the coach typed this corpus",
	"SetCoachSessionMatchContext": "the session's own surface — what the coach observed, never persisted",
	"CreateProfile":               "ends the session instead (design rule 4)",
	"SwitchProfile":               "ends the session instead (design rule 4)",
	"RenameProfile":               "ends the session instead (design rule 4)",
	"DeleteProfile":               "does not touch the active store",
	"ResetForTest":                "ends the session first (design rule 12)",
}

// The gate list is COMPLETE: every exported *App method that reads as a
// mutation is either gated or exempt on the record. This is the net that
// catches a future orchestrator added without assertNoCoachSession.
func TestCoachSession_GateListIsComplete(t *testing.T) {
	a, _ := coachApp(t)
	gated := gatedWrites(a)
	for method := range reflect.TypeFor[*app.App]().Methods() {
		name := method.Name
		if !hasMutatingVerb(name) || gated[name] != nil || ungatedByDesign[name] != "" {
			continue
		}
		t.Errorf("*App.%s reads as a mutation but is neither in gatedWrites nor in ungatedByDesign — "+
			"add assertNoCoachSession() and a row, or state why it is exempt", name)
	}
}

func hasMutatingVerb(name string) bool {
	for _, verb := range mutatingVerbs {
		if strings.HasPrefix(name, verb) {
			return true
		}
	}
	return false
}

// A profile switch discards the session rather than leaving it pointed at
// another profile's coach rows (design rule 4).
func TestCoachSession_ProfileSwitchEndsTheSession(t *testing.T) {
	isolateInstall(t)
	a := app.NewWithStore(dbtest.New())
	a.Startup(t.Context())
	if _, err := a.OpenCoachSession(shareBundle(t)); err != nil {
		t.Fatalf("OpenCoachSession: %v", err)
	}
	mustNoErr(t, a.CreateProfile("second"))
	if _, err := a.GetCoachSession(); !errors.Is(err, coach.ErrNoSession) {
		t.Errorf("GetCoachSession after a profile switch = %v, want coach.ErrNoSession", err)
	}
}
