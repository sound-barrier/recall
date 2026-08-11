package bundle_test

import (
	"slices"
	"sort"
	"testing"

	"recall/pkg/bundle"
	"recall/pkg/db"
	"recall/pkg/db/dbtest"
	"recall/pkg/match"
	"recall/pkg/parser"
)

// The toggle fixture's match keys. Each one is the sole witness for one
// arm of the include-set decision, so a bundle's key list names exactly which
// arm misfired.
const (
	pickedKey    = "picked"   // ticked in the Matches list
	unpickedKey  = "unpicked" // a normal match the user did NOT tick
	noMapKey     = "no-map"   // map never parsed — the "unknown" bucket
	hiddenKey    = "hidden-1" // soft-deleted
	ambiguousKey = "ambiguous-1"
)

// toggleFixture returns a store holding one summary row per fixture key plus
// the aggregated records the shell hands Export. The records are what the
// toggles read; the rows are what actually lands in data.json.
func toggleFixture(t *testing.T) (*dbtest.Fake, []match.Record) {
	t.Helper()
	f := dbtest.New()
	for _, k := range []string{pickedKey, unpickedKey, noMapKey, hiddenKey, ambiguousKey} {
		f.Summaries = append(f.Summaries, db.SummaryRow{Filename: k + ".png", MatchKey: k})
	}
	return f, []match.Record{
		{MatchKey: pickedKey, Data: parser.MatchResult{Map: "ilios"}},
		{MatchKey: unpickedKey, Data: parser.MatchResult{Map: "numbani"}},
		{MatchKey: noMapKey},
		{MatchKey: hiddenKey, Data: parser.MatchResult{Map: "busan"}, Hidden: true},
		{MatchKey: ambiguousKey, Ambiguous: true},
	}
}

// exportedKeys is the distinct match_key set a bundle's data.json carries,
// sorted — the answer to "what did this export actually contain".
func exportedKeys(t *testing.T, payload []byte) []string {
	t.Helper()
	d := exportedData(t, payload)
	out := make([]string, 0, len(d.Summaries))
	for _, s := range d.Summaries {
		out = append(out, s.MatchKey)
	}
	sort.Strings(out)
	return out
}

// The two toggles are the only way to get a match into a bundle that the
// Matches list won't let the user tick, so each one's reach is a contract: too
// narrow and a shared bundle is missing the very matches it was assembled to
// explain; too wide and it carries matches the user never agreed to share.
// The toggles UNION keys onto the selection — neither one can subtract.
func TestExport_ToggleMatrixDecidesTheIncludeSet(t *testing.T) {
	tests := []struct {
		name           string
		matchKeys      []string
		includeUnknown bool
		includeHidden  bool
		want           []string
	}{
		{
			name:      "no toggles ships exactly the ticked keys",
			matchKeys: []string{pickedKey},
			want:      []string{pickedKey},
		},
		{
			// An ambiguous record has no map either, so it rides along. The
			// export modal's "N unknown matches" count comes from the store's
			// unknownRecords getter, which excludes ambiguous records — so the
			// bundle is wider than the number the user was shown.
			name:           "include-unknown adds every map-less record",
			matchKeys:      []string{pickedKey},
			includeUnknown: true,
			want:           []string{ambiguousKey, noMapKey, pickedKey},
		},
		{
			name:          "include-hidden adds the soft-deleted, not the map-less",
			matchKeys:     []string{pickedKey},
			includeHidden: true,
			want:          []string{hiddenKey, pickedKey},
		},
		{
			name:           "both toggles add both buckets, never the unticked normal match",
			matchKeys:      []string{pickedKey},
			includeUnknown: true,
			includeHidden:  true,
			want:           []string{ambiguousKey, hiddenKey, noMapKey, pickedKey},
		},
		{
			// The toggle is additive, so a real match whose map OCR failed is
			// NOT filtered back out when the user leaves the toggle off — it
			// ships because they ticked it.
			name:      "a ticked map-less match ships with the unknown toggle off",
			matchKeys: []string{noMapKey},
			want:      []string{noMapKey},
		},
		{
			name:      "an empty selection with no toggles is an empty bundle",
			matchKeys: nil,
			want:      []string{},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			store, recs := toggleFixture(t)
			opts := bundle.ExportBundleOptions{
				MatchKeys:      tc.matchKeys,
				IncludeUnknown: tc.includeUnknown,
				IncludeHidden:  tc.includeHidden,
			}
			payload, err := bundle.Export(store, opts, recs, t.TempDir(), seededVersion)
			if err != nil {
				t.Fatalf("Export: %v", err)
			}
			if got := exportedKeys(t, payload); !slices.Equal(got, tc.want) {
				t.Errorf("exported keys = %v, want %v", got, tc.want)
			}
			assertManifestDeclaresToggles(t, payload, opts, len(tc.want))
		})
	}
}

// The manifest is what a recipient (and cmd/bug-finder) reads to know how a
// bundle was assembled, so its declared toggles and match_count have to match
// what the ZIP holds — a bundle that under-reports its own reach can't be
// validated.
func assertManifestDeclaresToggles(t *testing.T, payload []byte, opts bundle.ExportBundleOptions, wantCount int) {
	t.Helper()
	mf := exportedManifest(t, payload)
	if mf.IncludeUnknown != opts.IncludeUnknown || mf.IncludeHidden != opts.IncludeHidden {
		t.Errorf("manifest toggles = unknown:%t hidden:%t, want unknown:%t hidden:%t",
			mf.IncludeUnknown, mf.IncludeHidden, opts.IncludeUnknown, opts.IncludeHidden)
	}
	if mf.MatchCount != wantCount {
		t.Errorf("manifest match_count = %d, want %d", mf.MatchCount, wantCount)
	}
}
