package bundle_test

import (
	"reflect"
	"slices"
	"testing"

	"recall/pkg/bundle"
	"recall/pkg/db"
)

// What a share bundle carries is a privacy disclosure, and the disclosure is
// a paragraph in ExportBundleModal.vue that no compiler reads.
//
// Twice now the two have parted. A code comment asserted "the bundle carries
// no screenshots" while Export() wrote screenshots/* into every one. The
// share dialog then enumerated notes, tags, squads and replay codes at the
// moment a player decides to hand the file to another human, and by the time
// anyone reread it the layer had also grown the player's own moments — a list
// of their own mistakes, timestamped.
//
// So the field set is pinned here. Growing DataV2's user layer fails this
// test, and the fix is to say so in the dialog and add the field below. It
// cannot check the WORDS — nothing in Go can — but it can guarantee nobody
// adds a surface without being asked about them.
func TestDataV2_UserLayerFieldsAreDisclosedInTheShareDialog(t *testing.T) {
	// Each entry names a field on DataV2 that leaves the player's machine,
	// beside the phrase the share dialog uses for it.
	disclosed := map[string]string{
		"UserMatchData": "each match's JSON data (manual entries and your edits)",
		"Annotations":   "your notes, the tags and squads, replay codes, why a match does not count, and who you marked as leaving or throwing",
		"Reviews":       "which matches you marked reviewed",
		"Queues":        "which matches you marked reviewed",
		"PlayModes":     "each match's JSON data (manual entries and your edits)",
		"Hidden":        "each match's JSON data (manual entries and your edits)",
		"Pinned":        "each match's JSON data (manual entries and your edits)",
		"CoachNotes":    "any review an earlier coach sent back",
		"Moments":       "your notes and moments",
		"SelfReviews":   "your own reviews of them",
	}
	// The OCR tables above the user layer. Named rather than skipped by
	// position so reordering the struct cannot quietly widen the exemption.
	ocr := []string{"Schema", "ExportedAt", "RecallVersion", "Summaries", "Teams", "Personals", "Ranks", "Unknowns"}

	rt := reflect.TypeFor[bundle.DataV2]()
	for field := range rt.Fields() {
		name := field.Name
		if slices.Contains(ocr, name) {
			continue
		}
		// A field the SHARE path leaves behind needs no disclosure, because
		// nothing to disclose leaves the machine — and that exemption is
		// PROVEN below rather than asserted here, so adding a name to the set
		// is not a way around this gate.
		if slices.Contains(selfExportOnly, name) {
			continue
		}
		if _, ok := disclosed[name]; !ok {
			t.Errorf("DataV2.%s leaves the player's machine in a share bundle and the "+
				"share dialog does not say so.\n"+
				"Add it to the paragraph in ExportBundleModal.vue, then add it here.", name)
		}
	}
	for name := range disclosed {
		if _, ok := rt.FieldByName(name); !ok {
			t.Errorf("the share dialog discloses %q, which DataV2 no longer carries — "+
				"the copy overstates what leaves the machine", name)
		}
	}
}

// selfExportOnly names the DataV2 fields a SHARE bundle leaves behind. They
// need no line in the share dialog because they never reach a coach — and the
// test below holds them to that, so the set cannot become a way of skipping
// the disclosure gate above.
var selfExportOnly = []string{"Roster"}

func TestDataV2_SelfExportOnlyFieldsAreAbsentFromAShareBundle(t *testing.T) {
	shots := t.TempDir()
	store := seededStore(t, shots)
	writeShots(t, shots, seededParentFiles()...)
	// Seed every self-export-only surface, so an empty field in the share
	// bundle means "left behind" rather than "never had anything".
	if err := store.SetRosterMember(db.RosterMember{Tag: "Zed#2100", DisplayName: "Zed"}); err != nil {
		t.Fatalf("seed roster: %v", err)
	}

	shared, err := bundle.Export(store, bundle.ExportBundleOptions{
		MatchKeys: seededKeys(),
		Player:    &bundle.PlayerIdentity{Handle: "Sable"},
	}, nil, shots, seededVersion)
	if err != nil {
		t.Fatalf("Export (share): %v", err)
	}
	self, err := bundle.Export(store, bundle.ExportBundleOptions{MatchKeys: seededKeys()}, nil, shots, seededVersion)
	if err != nil {
		t.Fatalf("Export (self): %v", err)
	}

	sharedData := reflect.ValueOf(exportedData(t, shared))
	selfData := reflect.ValueOf(exportedData(t, self))
	for _, name := range selfExportOnly {
		if !sharedData.FieldByName(name).IsZero() {
			t.Errorf("DataV2.%s is exempt from the share disclosure but a share bundle carries it", name)
		}
		if selfData.FieldByName(name).IsZero() {
			t.Errorf("DataV2.%s is empty in a SELF export too — the exemption proves nothing", name)
		}
	}
}
