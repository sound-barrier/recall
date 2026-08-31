package correlate

import (
	"time"

	"recall/pkg/db"
)

// ReasonSameInstant marks a candidate proposed by the re-capture sweep:
// two matches whose SUMMARY rows report the same played-at instant, map,
// result and final score.
const ReasonSameInstant = "same_instant"

// The re-capture sweep — the duplicate detector for players who screenshot
// the SUMMARY screen and nothing else.
//
// FindDuplicateMatches fingerprints the TEAMS scoreboard, which is where
// E/A/D and damage/healing/mitigation live. A match captured twice with no
// TEAMS shot on either side therefore has nothing to compare, and the two
// copies sit in the list forever, obviously the same game to a human and
// invisible to the sweep.
//
// This one matches on the match's OWN identity instead of on its stats.
// played_at_utc is derived from the scoreboard's date + finished_at, so it
// says when the MATCH ended, not when the screenshot was taken: two captures
// of one game carry the same instant. Map, result, final score, hero and
// game length ride along — all six must agree.
//
// Two deliberate differences from its sibling:
//
//   - No capture-distance window. The stat-line sweep caps at seven days
//     because stat lines can coincide by chance, and its confidence decays
//     with distance. An instant does not decay that way.
//   - It may fire INSIDE the EAD bridge's 30-minute window, which is what
//     retired the old derive-the-reason-from-distance trick: the two
//     producers no longer occupy complementary bands, so the reason is
//     stored on the candidate row.
//
// Two honest limits, both from played_at_utc being stamped in the PARSING
// machine's timezone:
//
//   - A folder re-imported on a machine set to a different zone stamps a
//     different instant for the same scoreboard, and the pair is missed.
//     A miss, not a false flag.
//   - In the one repeated hour of a DST fall-back, two matches an hour
//     apart resolve to the SAME instant. Map, result, score, hero and
//     length all matching as well is why the fingerprint is six fields
//     wide and not three — a false flag here costs the user a real match,
//     which is the expensive direction.

// summaryIdentity is the fingerprint two captures of one match agree on.
// Comparable so two identities match with ==.
//
// Six fields, not the three that establish identity, because the instant is
// not quite unique: across a DST fall-back the repeated hour resolves two
// different matches to the same UTC instant. Hero and game length are the
// cheap corroboration that makes such a collision require two matches an
// hour apart to have been the same map, the same result, the same score,
// the same hero and the same length.
type summaryIdentity struct {
	instant    string
	mapName    string
	result     string
	finalScore string
	hero       string
	gameLength string
}

// identityOf reads a SUMMARY row's identity, reporting false when the row
// cannot establish one. The instant, the map and the result are all
// required: without them "identical" would mean "equally empty", and two
// data-poor rows would flag each other. Final score is compared but not
// required — a missing score costs a real duplicate its flag, which is a
// miss, while a fabricated one would cost a real match its identity. Hero
// and game length are corroboration on the same terms.
func identityOf(r db.SummaryRow) (summaryIdentity, bool) {
	if r.PlayedAtUTC == nil || *r.PlayedAtUTC == "" || r.Map == "" || r.Result == "" {
		return summaryIdentity{}, false
	}
	return summaryIdentity{
		instant:    *r.PlayedAtUTC,
		mapName:    r.Map,
		result:     r.Result,
		finalScore: r.FinalScore,
		hero:       r.Hero,
		gameLength: r.GameLength,
	}, true
}

// stampedIdentity pairs one row's identity with its filename capture
// timestamp — the same gate every other producer in this package applies,
// and the only honest source for the distance the candidate reports.
type stampedIdentity struct {
	identity summaryIdentity
	ts       time.Time
}
