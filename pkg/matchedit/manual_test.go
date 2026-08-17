package matchedit_test

import (
	"errors"
	"slices"
	"testing"
	"time"

	"recall/pkg/db"
	"recall/pkg/match"
	"recall/pkg/matchedit"
)

func manualInput(mapName, result string) match.ManualMatchInput {
	return match.ManualMatchInput{
		Map:      mapName,
		Result:   result,
		PlayedAt: "2026-06-15T14:30:00Z",
	}
}

// The played_at timestamp's WALL CLOCK (in its stated offset) drives the match
// key, date, and finished_at — matching OCR rows, which store the player's
// local wall clock. A UTC conversion here would shift a Denver 8pm entry to
// 02:00 next-day and break every time-based sort and filter. The canonical UTC
// instant rides alongside, exact because the input carried its offset.
func TestCreateManual_MintsTheKeyFromTheWallClock(t *testing.T) {
	fake := seeded()
	in := manualInput("ilios", "victory")
	in.PlayedAt = "2026-06-15T14:30:00-08:00"

	key, err := matchedit.CreateManual(fake, in)
	mustNoErr(t, err)

	if want := "match-2026-06-15T14-30-00"; key != want {
		t.Errorf("key = %q, want %q (wall clock, not UTC)", key, want)
	}
	row := fake.UserMatchData[key]
	if row.Date == nil || *row.Date != "2026-06-15" {
		t.Errorf("Date = %v, want 2026-06-15", row.Date)
	}
	if row.FinishedAt == nil || *row.FinishedAt != "14:30" {
		t.Errorf("FinishedAt = %v, want 14:30", row.FinishedAt)
	}
	if row.PlayedAtUTC == nil || *row.PlayedAtUTC != "2026-06-15T22:30:00Z" {
		t.Errorf("PlayedAtUTC = %v, want 2026-06-15T22:30:00Z", row.PlayedAtUTC)
	}
}

// An omitted played_at means "now" — the quick-add's most common path, fired
// seconds after the match ended.
func TestCreateManual_DefaultsPlayedAtToNow(t *testing.T) {
	fake := seeded()
	in := manualInput("ilios", "defeat")
	in.PlayedAt = ""

	key, err := matchedit.CreateManual(fake, in)
	mustNoErr(t, err)

	row := fake.UserMatchData[key]
	if row.Date == nil || *row.Date != time.Now().Format("2006-01-02") {
		t.Errorf("Date = %v, want today", row.Date)
	}
}

func TestCreateManual_RejectsAnUnparseablePlayedAt(t *testing.T) {
	fake := seeded()
	for _, bad := range []string{"2026-06-15", "yesterday", "2026-06-15 14:30:00"} {
		in := manualInput("ilios", "victory")
		in.PlayedAt = bad
		if _, err := matchedit.CreateManual(fake, in); !errors.Is(err, matchedit.ErrInvalidPlayedAt) {
			t.Errorf("played_at %q: err = %v, want ErrInvalidPlayedAt", bad, err)
		}
	}
	if len(fake.UserMatchData) != 0 {
		t.Errorf("refused create still wrote a row: %v", fake.UserMatchData)
	}
}

// Two matches cannot share a minute: the key is minted from the wall clock, so
// a second entry at the same time would silently overwrite the first. The user
// is asked to pick a different minute instead.
func TestCreateManual_RejectsACollisionWithAnOCRMatch(t *testing.T) {
	fake := seeded("match-2026-06-15T14-30-00")
	if _, err := matchedit.CreateManual(fake, manualInput("ilios", "victory")); !errors.Is(err, matchedit.ErrMatchKeyExists) {
		t.Errorf("err = %v, want ErrMatchKeyExists", err)
	}
	if len(fake.UserMatchData) != 0 {
		t.Errorf("refused create still wrote an override row: %v", fake.UserMatchData)
	}
}

// The collision guard has to see the override layer too, not just screenshot
// rows — a manual match lives ONLY there, so checking screenshots alone would
// let the second entry overwrite the first with no error at all.
func TestCreateManual_RejectsACollisionWithAnEarlierManualMatch(t *testing.T) {
	fake := seeded()
	first, err := matchedit.CreateManual(fake, manualInput("ilios", "victory"))
	mustNoErr(t, err)

	_, err = matchedit.CreateManual(fake, manualInput("rialto", "defeat"))
	if !errors.Is(err, matchedit.ErrMatchKeyExists) {
		t.Fatalf("err = %v, want ErrMatchKeyExists", err)
	}
	if row := fake.UserMatchData[first]; row.Map == nil || *row.Map != "ilios" {
		t.Errorf("first match's map = %v, want it untouched at ilios", row.Map)
	}
	if len(fake.UserMatchData) != 1 {
		t.Errorf("override rows = %d, want only the first", len(fake.UserMatchData))
	}
}

func TestCreateManual_WritesTheOverrideRow(t *testing.T) {
	fake := seeded()
	in := manualInput("ilios", "victory")
	in.Heroes = []string{"ana", "kiriko"}

	key, err := matchedit.CreateManual(fake, in)
	mustNoErr(t, err)

	row := fake.UserMatchData[key]
	if row.Map == nil || *row.Map != "ilios" || row.Result == nil || *row.Result != "victory" {
		t.Errorf("map/result = %v/%v, want ilios/victory", row.Map, row.Result)
	}
	if row.Hero == nil || *row.Hero != "ana" {
		t.Errorf("primary hero = %v, want ana (heroes[0])", row.Hero)
	}
	if len(row.Heroes) != 2 || row.Heroes[1].Hero != "kiriko" || row.Heroes[1].Position != 1 {
		t.Errorf("Heroes = %+v, want ana at 0 and kiriko at 1", row.Heroes)
	}
}

// A quick-add carries no hero at all. The column stays NULL rather than
// holding an empty override, so the record reads as "not recorded" instead of
// "played nobody".
func TestCreateManual_LeavesAnAbsentHeroNull(t *testing.T) {
	fake := seeded()
	key, err := matchedit.CreateManual(fake, manualInput("ilios", "defeat"))
	mustNoErr(t, err)

	row := fake.UserMatchData[key]
	if row.Hero != nil {
		t.Errorf("Hero = %v, want nil on a hero-less quick entry", row.Hero)
	}
	if len(row.Heroes) != 0 {
		t.Errorf("Heroes = %+v, want none", row.Heroes)
	}
}

func TestCreateManual_WritesTheAuxRows(t *testing.T) {
	fake := seeded()
	in := manualInput("ilios", "victory")
	in.PlayMode, in.QueueType = "competitive", "role"
	in.Leavers, in.Throwers = []string{"team"}, []string{"enemy"}
	in.ReplayCode, in.Note = "ABC123", "great comeback"
	in.Tags, in.Members = []string{"clutch"}, []string{"Apollo#11234"}

	key, err := matchedit.CreateManual(fake, in)
	mustNoErr(t, err)

	if got := fake.PlayModes[key].PlayMode; got != "competitive" {
		t.Errorf("play_mode = %q, want competitive", got)
	}
	if got := fake.Queues[key].QueueType; got != "role" {
		t.Errorf("queue_type = %q, want role", got)
	}
	ann := fake.Annotations[key]
	assertManualDisruption(t, ann)
	assertManualNarrative(t, ann)
}

// assertManualDisruption pins the leaver / thrower sides, which ride the
// annotation surface rather than the override row.
func assertManualDisruption(t *testing.T, ann db.Annotation) {
	t.Helper()
	if !slices.Equal(ann.Leavers, []string{"team"}) {
		t.Errorf("Leavers = %v, want [team]", ann.Leavers)
	}
	if !slices.Equal(ann.Throwers, []string{"enemy"}) {
		t.Errorf("Throwers = %v, want [enemy]", ann.Throwers)
	}
}

// assertManualNarrative pins the free-text and list fields the manual form
// hands to the same upsert.
func assertManualNarrative(t *testing.T, ann db.Annotation) {
	t.Helper()
	if ann.ReplayCode != "ABC123" || ann.Note != "great comeback" {
		t.Errorf("replay/note = %q/%q, want ABC123 / great comeback", ann.ReplayCode, ann.Note)
	}
	if !slices.Equal(ann.Tags, []string{"clutch"}) {
		t.Errorf("Tags = %v, want [clutch]", ann.Tags)
	}
	if !slices.Equal(ann.Members, []string{"Apollo#11234"}) {
		t.Errorf("Members = %v, want [Apollo#11234]", ann.Members)
	}
}

// Omission is free: a quick-add knows the map and the outcome, not how the
// game was queued, and writing "" would claim it did.
func TestCreateManual_SkipsTheAuxRowsWhenOmitted(t *testing.T) {
	fake := seeded()
	key, err := matchedit.CreateManual(fake, manualInput("ilios", "victory"))
	mustNoErr(t, err)

	if _, ok := fake.PlayModes[key]; ok {
		t.Errorf("play_mode row written for an omitted mode: %+v", fake.PlayModes[key])
	}
	if _, ok := fake.Queues[key]; ok {
		t.Errorf("queue row written for an omitted queue: %+v", fake.Queues[key])
	}
	if _, ok := fake.Annotations[key]; ok {
		t.Errorf("annotation row written with nothing to annotate: %+v", fake.Annotations[key])
	}
}

// Only map and result are required — the leaver-exit quick-add records a match
// the game erased from history, where the user knows nothing else. A value that
// IS supplied still has to be valid; only omission is free.
func TestCreateManual_Validates(t *testing.T) {
	base := match.ManualMatchInput{
		Map: "ilios", PlayMode: "competitive", QueueType: "role",
		Heroes: []string{"ana"}, Result: "victory",
	}
	cases := []struct {
		name string
		mut  func(*match.ManualMatchInput)
		want error
	}{
		{"no map", func(m *match.ManualMatchInput) { m.Map = "" }, matchedit.ErrManualNeedsMap},
		{"no result", func(m *match.ManualMatchInput) { m.Result = "" }, matchedit.ErrInvalidResult},
		{"bad result", func(m *match.ManualMatchInput) { m.Result = "win" }, matchedit.ErrInvalidResult},
		{"bad leaver", func(m *match.ManualMatchInput) { m.Leavers = []string{"afk"} }, matchedit.ErrInvalidLeaver},
		{"bad thrower", func(m *match.ManualMatchInput) { m.Throwers = []string{"griefer"} }, matchedit.ErrInvalidThrower},
		{"bad play_mode", func(m *match.ManualMatchInput) { m.PlayMode = "ranked" }, matchedit.ErrInvalidPlayMode},
		{"bad queue", func(m *match.ManualMatchInput) { m.QueueType = "5v5" }, matchedit.ErrInvalidQueueType},
		{"unknown map", func(m *match.ManualMatchInput) { m.Map = "notamap" }, matchedit.ErrUnknownMap},
		{"unknown hero", func(m *match.ManualMatchInput) { m.Heroes = []string{"notahero"} }, matchedit.ErrUnknownHero},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			in := base
			tc.mut(&in)
			fake := seeded()
			if _, err := matchedit.CreateManual(fake, in); !errors.Is(err, tc.want) {
				t.Errorf("err = %v, want %v", err, tc.want)
			}
			if len(fake.UserMatchData) != 0 {
				t.Errorf("refused create still wrote an override row")
			}
		})
	}
}

// Omitting the optional fields is not a validation failure — this is the
// other half of the table above, and the case the quick-add actually sends.
func TestCreateManual_AcceptsAnOmittedHeroModeAndQueue(t *testing.T) {
	mustNoErr(t, func() error {
		_, err := matchedit.CreateManual(seeded(), manualInput("ilios", "draw"))
		return err
	}())
}
