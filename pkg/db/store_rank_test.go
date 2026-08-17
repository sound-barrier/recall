package db_test

import (
	"strings"
	"testing"

	"recall/pkg/db"
)

// The rank_modifiers.modifier CHECK still constrains the column, so a value
// outside the vocabulary never reaches the table. What CHANGED is the cost of
// hitting it: the write no longer takes the rank row down with it.
//
// The vocabulary is loaded from modifiers.yaml at RUNTIME (owdata.go's
// user-override path), while a table's CHECK is frozen in its DDL when the
// table is created and SQLite cannot widen one afterwards. So the parser
// emitting something this database will not accept is a reachable state, not
// a hypothetical — and it used to discard tier, division, progress and SR
// along with the pill, silently, because pkg/app clears the failed-files
// ledger entry before the write runs.
func TestSQLStore_RankModifiers_UnknownValueCostsThePillNotTheRow(t *testing.T) {
	s := openMemory(t)

	if err := s.UpsertRank(db.RankRow{
		Filename: "r.png", MatchKey: "k1", Rank: "platinum", Level: 2, RankProgress: 67,
		Modifiers: []string{"demotion protection", "unranked yolo"},
		SR:        []db.HeroSR{{Hero: "juno", SR: 2065}},
	}); err != nil {
		t.Fatalf("UpsertRank = %v, want the row stored without the unknown modifier", err)
	}

	got := loadOneRank(t, s)
	if got.Rank != "platinum" || got.Level != 2 || got.RankProgress != 67 {
		t.Errorf("rank = %q %d @%d%%, want platinum 2 @67%%", got.Rank, got.Level, got.RankProgress)
	}
	if len(got.SR) != 1 || got.SR[0].SR != 2065 {
		t.Errorf("sr = %+v, want juno at 2065", got.SR)
	}
	// The known one is stored; the unknown one is dropped, not stored raw —
	// the CHECK is still the gate on what the column may hold.
	if len(got.Modifiers) != 1 || got.Modifiers[0] != "demotion protection" {
		t.Errorf("modifiers = %v, want only [demotion protection]", got.Modifiers)
	}
}

// loadOneRank returns the single rank row in the store.
func loadOneRank(t *testing.T, s *db.SQLStore) db.RankRow {
	t.Helper()
	snap, err := s.LoadAll()
	mustNoErr(t, err)
	if len(snap.Ranks) != 1 {
		t.Fatalf("rank rows = %d, want 1", len(snap.Ranks))
	}
	return snap.Ranks[0]
}

// Re-parsing a screenshot re-runs UpsertRank on the same filename. Modifiers
// and SR are DELETE-then-INSERT precisely because a re-parse that drops a
// modifier (or a hero's SR line) has to remove the old row — a plain UPSERT
// would leave it, and the match would accumulate modifiers it never had. The
// parent row itself must survive intact: same id, and parsed_at still the
// first-insert stamp (it is deliberately absent from the SET clause).
func TestSQLStore_UpsertRank_ReParseReplacesChildrenAndKeepsTheParent(t *testing.T) {
	s := openMemory(t)
	first := db.RankRow{
		Filename: "r.png", MatchKey: "k1", Rank: "platinum", Level: 3,
		Modifiers: []string{"win streak", "victory"},
		SR: []db.HeroSR{
			{Hero: "juno", SR: 2500, Change: 21},
			{Hero: "lucio", SR: 2400, Change: 19},
		},
	}
	mustNoErr(t, s.UpsertRank(first))
	before := loadOneRank(t, s)

	second := first
	second.Level = 4
	second.Modifiers = []string{"victory"}
	second.SR = []db.HeroSR{{Hero: "juno", SR: 2521, Change: 21}}
	mustNoErr(t, s.UpsertRank(second))

	after := loadOneRank(t, s)
	if after.ID != before.ID {
		t.Errorf("id = %d, want %d (re-parse must update in place)", after.ID, before.ID)
	}
	if after.ParsedAt != before.ParsedAt {
		t.Errorf("parsed_at = %q, want the first-insert stamp %q", after.ParsedAt, before.ParsedAt)
	}
	if after.Level != 4 {
		t.Errorf("level = %d, want the re-parsed 4", after.Level)
	}
	if len(after.Modifiers) != 1 || after.Modifiers[0] != "victory" {
		t.Errorf("modifiers = %v, want only [victory] — the dropped one accumulated", after.Modifiers)
	}
	if len(after.SR) != 1 || after.SR[0].SR != 2521 {
		t.Errorf("sr = %+v, want only juno at 2521", after.SR)
	}
}

// Rank children are read with ONE bulk SELECT per child table and grafted back
// onto their parent by id. With two rank screenshots in the DB, a broken graft
// shows up as one match wearing another's SR line and modifiers — a wrong
// number the user has no way to trace.
func TestSQLStore_LoadAll_RankChildrenAttachToTheirOwnParent(t *testing.T) {
	s := openMemory(t)
	mustNoErr(t, s.UpsertRank(db.RankRow{
		Filename: "r1.png", MatchKey: "k1", Rank: "platinum",
		Modifiers: []string{"win streak"},
		SR:        []db.HeroSR{{Hero: "juno", SR: 2500, Change: 21}},
	}))
	mustNoErr(t, s.UpsertRank(db.RankRow{
		Filename: "r2.png", MatchKey: "k2", Rank: "diamond",
		Modifiers: []string{"loss streak"},
		SR:        []db.HeroSR{{Hero: "lucio", SR: 3100, Change: -18}},
	}))

	snap, err := s.LoadAll()
	mustNoErr(t, err)
	if len(snap.Ranks) != 2 {
		t.Fatalf("rank rows = %d, want 2", len(snap.Ranks))
	}
	byFile := map[string]db.RankRow{}
	for _, r := range snap.Ranks {
		byFile[r.Filename] = r
	}
	assertRankChildren(t, byFile["r1.png"], "win streak", "juno")
	assertRankChildren(t, byFile["r2.png"], "loss streak", "lucio")
}

// The parent row, its modifiers, and its SR lines are written in ONE
// transaction, so a child the schema rejects has to take the parent with it —
// otherwise a re-parse leaves a rank screenshot recorded with its old SR
// still attached and the new one silently missing, which reads as a real
// (wrong) number rather than as a failure. Duplicate SR heroes collide on the
// (rank_screenshot_id, hero) primary key; the OCR path stores them strictly,
// unlike the lenient user-override twin.
func TestSQLStore_UpsertRank_RejectedChildLeavesNoPartialRow(t *testing.T) {
	s := openMemory(t)
	err := s.UpsertRank(db.RankRow{
		Filename: "r.png", MatchKey: "k1", Rank: "platinum",
		Modifiers: []string{"win streak"},
		SR: []db.HeroSR{
			{Hero: "juno", SR: 2500, Change: 21},
			{Hero: "juno", SR: 2521, Change: 21},
		},
	})
	if err == nil {
		t.Fatal("duplicate SR heroes were accepted, want a primary-key violation")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "constraint") {
		t.Errorf("error = %q, want it to name the constraint", err)
	}

	snap, err := s.LoadAll()
	mustNoErr(t, err)
	if len(snap.Ranks) != 0 {
		t.Errorf("rank rows = %+v, want none — the parent survived its child's rejection", snap.Ranks)
	}
}

// assertRankChildren pins that a rank row carries exactly its own modifier and
// SR hero — no cross-contamination from the sibling row.
func assertRankChildren(t *testing.T, r db.RankRow, wantModifier, wantHero string) {
	t.Helper()
	if len(r.Modifiers) != 1 || r.Modifiers[0] != wantModifier {
		t.Errorf("%s modifiers = %v, want only [%s]", r.Filename, r.Modifiers, wantModifier)
	}
	if len(r.SR) != 1 || r.SR[0].Hero != wantHero {
		t.Errorf("%s sr = %+v, want only %s", r.Filename, r.SR, wantHero)
	}
}
