package cmd_test

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"

	"recall/pkg/app"
	"recall/pkg/cmd"
	"recall/pkg/matchedit"
)

// The sentinel ladder — the regression net for carving pkg/app apart.
//
// Every write handler funnels a failure through writeError, which picks an
// HTTP status by errors.Is against a sentinel. 41 app.Err* values reach that
// ladder from pkg/cmd today, and a decomposition moves many of them into leaf
// packages behind `var ErrX = leaf.ErrX` re-exports.
//
// A DROPPED alias is not the danger: pkg/cmd names app.ErrX directly, so
// deleting one is a compile error. The silent failure is an alias that is
// RE-DECLARED rather than aliased (`var ErrX = errors.New("...")`), or one
// re-wrapped as `fmt.Errorf("%w: …", leaf.ErrX)`. The first breaks errors.Is,
// so the route quietly falls through to 500; the second keeps errors.Is but
// changes the problem+json `detail` the client reads, which no status
// assertion would catch. Both are invisible at the mapping site.
//
// So this pins three things a carve must preserve: the exact message, the
// distinct identity, and the match-through-a-wrap. It passes today; it exists
// to keep passing.

type sentinel struct {
	name string
	err  error
	// msg is the exact Error() string. Empty means the sentinel is already a
	// re-export of a leaf package's value — the message is owned there, and
	// pinning it here would duplicate that package's own test.
	msg string
}

// Every app.Err* that pkg/cmd references. Kept sorted; the completeness test
// below fails if the source grows one this table does not name.
var sentinels = []sentinel{
	{"ErrAmbiguousNotFound", app.ErrAmbiguousNotFound, "ambiguous screenshot not found"},
	{"ErrCoachNameInvalid", app.ErrCoachNameInvalid, "invalid coach name"},
	{"ErrDataUpdateChecksum", app.ErrDataUpdateChecksum, ""},               // re-export of a leaf sentinel; message owned there
	{"ErrDataUpdateMainFetchFailed", app.ErrDataUpdateMainFetchFailed, ""}, // re-export of a leaf sentinel; message owned there
	{"ErrDataUpdateMalformed", app.ErrDataUpdateMalformed, ""},             // re-export of a leaf sentinel; message owned there
	{"ErrEmptyAnnotation", app.ErrEmptyAnnotation, "annotation has no content; use DELETE to clear it"},
	{"ErrIgnoreFilenameRequired", app.ErrIgnoreFilenameRequired, "filename is required"},
	{"ErrImportMalformed", app.ErrImportMalformed, ""}, // re-export of a leaf sentinel; message owned there
	{"ErrInvalidAmbiguousKey", app.ErrInvalidAmbiguousKey, "invalid ambiguous match key"},
	{"ErrInvalidBackupInterval", app.ErrInvalidBackupInterval, "invalid auto-backup interval"},
	{"ErrInvalidLeaver", app.ErrInvalidLeaver, "invalid leaver: each side must be 'self', 'team', or 'enemy'"},
	{"ErrInvalidMaintenanceOp", app.ErrInvalidMaintenanceOp, "unknown maintenance operation"},
	{"ErrInvalidPlayMode", app.ErrInvalidPlayMode, "invalid play_mode: must be 'quickplay' or 'competitive'"},
	{"ErrInvalidPlayedAt", app.ErrInvalidPlayedAt, "invalid played_at: must be RFC 3339"},
	{"ErrInvalidProfileName", app.ErrInvalidProfileName, ""}, // re-export of a leaf sentinel; message owned there
	{"ErrInvalidQueueType", app.ErrInvalidQueueType, "invalid queue_type: must be 'role' or 'open'"},
	{"ErrInvalidRank", app.ErrInvalidRank, "invalid rank: division, progress, or change_percent out of range"},
	{"ErrInvalidResolution", app.ErrInvalidResolution, "resolved_to is not a valid candidate"},
	{"ErrInvalidResult", app.ErrInvalidResult, "invalid result: must be 'victory', 'defeat', or 'draw'"},
	{"ErrInvalidReviewedBy", app.ErrInvalidReviewedBy, "invalid reviewed_by: must be 'self' or 'coach'"},
	{"ErrInvalidScreenshotsDir", app.ErrInvalidScreenshotsDir, "screenshots directory is not configured or unreadable"},
	{"ErrInvalidTesseractPath", app.ErrInvalidTesseractPath, "tesseract path is invalid"},
	{"ErrInvalidThrower", app.ErrInvalidThrower, "invalid thrower: each side must be 'self', 'team', or 'enemy'"},
	{"ErrManualNeedsMap", app.ErrManualNeedsMap, "map is required"},
	{"ErrMatchKeyExists", app.ErrMatchKeyExists, "a match already exists for that time; pick a different minute"},
	{"ErrMoveStrandsCandidate", app.ErrMoveStrandsCandidate, ""}, // re-export of a leaf sentinel; message owned there
	{"ErrMoveTargetIsActive", app.ErrMoveTargetIsActive, ""},     // re-export of a leaf sentinel; message owned there
	{"ErrNoFailedFiles", app.ErrNoFailedFiles, "no failed files to bundle"},
	{"ErrNoParseInFlight", app.ErrNoParseInFlight, "no parse in flight"},
	{"ErrParseInFlight", app.ErrParseInFlight, "a parse is already in flight"},
	{"ErrProfileActive", app.ErrProfileActive, ""},       // re-export of a leaf sentinel; message owned there
	{"ErrProfileExists", app.ErrProfileExists, ""},       // re-export of a leaf sentinel; message owned there
	{"ErrProfileImmutable", app.ErrProfileImmutable, ""}, // re-export of a leaf sentinel; message owned there
	{"ErrProfileNotFound", app.ErrProfileNotFound, ""},   // re-export of a leaf sentinel; message owned there
	{"ErrProfileSwitchDuringParse", app.ErrProfileSwitchDuringParse, "profiles: a parse is in flight — retry when it finishes"},
	{"ErrRestoreInvalid", app.ErrRestoreInvalid, "restore: not a valid Recall database"},
	{"ErrSelfUpdateUnavailable", app.ErrSelfUpdateUnavailable, "self-update unavailable on this install"},
	{"ErrStatOutOfRange", app.ErrStatOutOfRange, "invalid stat: a numeric value is out of range"},
	{"ErrUnknownHero", app.ErrUnknownHero, "unknown hero: not in the Overwatch roster"},
	{"ErrUnknownMap", app.ErrUnknownMap, "unknown map: not in the Overwatch roster"},
	{"ErrUnknownRank", app.ErrUnknownRank, "unknown rank: not on the competitive ladder"},
}

func TestSentinelLadder_MessagesAreStable(t *testing.T) {
	for _, s := range sentinels {
		if s.err == nil {
			t.Errorf("%s is nil — a carve dropped its value", s.name)
			continue
		}
		if s.msg == "" {
			continue
		}
		if got := s.err.Error(); got != s.msg {
			t.Errorf("%s message = %q, want %q — the problem+json detail changed with it",
				s.name, got, s.msg)
		}
	}
}

// Two sentinels collapsing to one value is what happens when a carve aliases a
// batch and mistypes one of them. errors.Is would then map both to whichever
// status the wrong one carries, on every route that raises either.
func TestSentinelLadder_SentinelsAreDistinct(t *testing.T) {
	for i, a := range sentinels {
		for _, b := range sentinels[i+1:] {
			if a.err == nil || b.err == nil {
				continue
			}
			if errors.Is(a.err, b.err) {
				t.Errorf("%s and %s are the same value — one aliases the other", a.name, b.name)
			}
		}
	}
}

// The carve-critical property. Leaves return their sentinel wrapped with
// context (`fmt.Errorf("%w: %s", ErrUnknownMap, name)`), and the whole ladder
// rests on that surviving the trip through an alias.
func TestSentinelLadder_WrappedSentinelsStillMatch(t *testing.T) {
	for _, s := range sentinels {
		if s.err == nil {
			continue
		}
		wrapped := fmt.Errorf("context that a leaf would add: %w", s.err)
		if !errors.Is(wrapped, s.err) {
			t.Errorf("%s does not survive %%w wrapping — errors.Is is broken for it", s.name)
		}
	}
}

// The route-INDEPENDENT half of the mapping. A sentinel in defaultProblems
// carries the same status everywhere; the rest get theirs from a handler's own
// cases, and for those writeError alone is documented to reach the 500 rung.
// Pinning that split is what catches a rung being added or lost by accident.
// routeIndependentStatuses indexes the sentinels whose status is the same on
// every route — the defaultProblems rungs. Everything else takes its status
// from a handler's own cases, so writeError alone reaches the 500 rung.
func routeIndependentStatuses(t *testing.T) map[string]int {
	t.Helper()
	out := map[string]int{}
	for i := range cmd.DefaultProblems {
		slug, status := cmd.ErrStatusProblem(i)
		if slug == "" {
			t.Errorf("defaultProblems[%d] has a problem type with no slug", i)
		}
		for _, s := range sentinels {
			if s.err != nil && errors.Is(s.err, cmd.ErrStatusIs(i)) {
				out[s.name] = status
			}
		}
	}
	return out
}

func assertLadderStatus(t *testing.T, s sentinel, want int, routeIndependent bool) {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPut, "/api/v1/probe", nil)
	if !cmd.WriteError(rec, req, s.err) {
		t.Errorf("%s: writeError reported nothing written", s.name)
		return
	}
	if rec.Code != want {
		verdict := "route-specific (status comes from the handler's own cases)"
		if routeIndependent {
			verdict = "route-independent (defaultProblems)"
		}
		t.Errorf("%s: writeError status = %d, want %d — %s", s.name, rec.Code, want, verdict)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "application/problem+json") {
		t.Errorf("%s: Content-Type = %q, want problem+json", s.name, ct)
	}
}

// The route-INDEPENDENT half of the mapping. Pinning the split is what catches
// a defaultProblems rung being added or lost by accident.
func TestSentinelLadder_RouteIndependentStatuses(t *testing.T) {
	inDefault := routeIndependentStatuses(t)
	for _, s := range sentinels {
		if s.err == nil {
			continue
		}
		want, routeIndependent := inDefault[s.name]
		if !routeIndependent {
			want = http.StatusInternalServerError
		}
		assertLadderStatus(t, s, want, routeIndependent)
	}
}

// The blind spot the tests above cannot see, and the one the carve actually
// risks. Everything so far compares app.ErrX against ITSELF, so an alias
// re-declared as `errors.New("<the same message>")` passes all of it: the
// message matches, it is still distinct from its siblings, it survives its own
// %w wrap, and writeError still maps it. Production breaks anyway — the leaf
// returns matchedit.ErrX, pkg/cmd checks app.ErrX, the two are different
// values, errors.Is is false, and the route answers 500.
//
// So this asserts the identity that actually matters: the value a LEAF
// produces is the value the shell's alias names. Every carved sentinel gets a
// row; the row is deleted only if the sentinel comes home.
func TestSentinelLadder_LeafSentinelsAreTheSameValue(t *testing.T) {
	carved := []struct {
		name  string
		alias error
		leaf  error
	}{
		{"ErrInvalidLeaver", app.ErrInvalidLeaver, matchedit.ErrInvalidLeaver},
		{"ErrInvalidThrower", app.ErrInvalidThrower, matchedit.ErrInvalidThrower},
		{"ErrEmptyAnnotation", app.ErrEmptyAnnotation, matchedit.ErrEmptyAnnotation},
		{"ErrInvalidPlayMode", app.ErrInvalidPlayMode, matchedit.ErrInvalidPlayMode},
		{"ErrInvalidQueueType", app.ErrInvalidQueueType, matchedit.ErrInvalidQueueType},
		{"ErrInvalidReviewedBy", app.ErrInvalidReviewedBy, matchedit.ErrInvalidReviewedBy},
		{"ErrIgnoreFilenameRequired", app.ErrIgnoreFilenameRequired, matchedit.ErrIgnoreFilenameRequired},
		{"ErrMatchKeyRequired", app.ErrMatchKeyRequired, matchedit.ErrMatchKeyRequired},
		{"ErrInvalidResult", app.ErrInvalidResult, matchedit.ErrInvalidResult},
		{"ErrStatOutOfRange", app.ErrStatOutOfRange, matchedit.ErrStatOutOfRange},
		{"ErrUnknownMap", app.ErrUnknownMap, matchedit.ErrUnknownMap},
		{"ErrUnknownHero", app.ErrUnknownHero, matchedit.ErrUnknownHero},
		{"ErrUnknownRank", app.ErrUnknownRank, matchedit.ErrUnknownRank},
		{"ErrManualNeedsMap", app.ErrManualNeedsMap, matchedit.ErrManualNeedsMap},
		{"ErrInvalidPlayedAt", app.ErrInvalidPlayedAt, matchedit.ErrInvalidPlayedAt},
		{"ErrInvalidRank", app.ErrInvalidRank, matchedit.ErrInvalidRank},
		{"ErrMatchKeyExists", app.ErrMatchKeyExists, matchedit.ErrMatchKeyExists},
	}

	for _, c := range carved {
		if c.alias == nil || c.leaf == nil {
			t.Errorf("%s: alias or leaf sentinel is nil", c.name)
			continue
		}
		// Identity, deliberately — NOT errors.Is. errors.Is would also pass
		// for an alias that merely WRAPS the leaf, and a wrapping alias keeps
		// the status while silently changing the problem+json detail the
		// client reads. The two must be the same value.
		//nolint:errorlint,err113 // identity is the assertion; errors.Is would accept a wrapping alias, which is the bug
		if c.alias != c.leaf {
			t.Errorf("%s: the shell's alias is not the leaf's value — a leaf error "+
				"will not satisfy errors.Is against it, and the route falls to 500", c.name)
		}
	}
}

// The table above goes stale the moment someone adds a sentinel and wires it
// into a handler. Reading the source is the only way to notice — the same
// approach the frontend uses to pin TIER_ORDER against ranks.yaml.
func TestSentinelLadder_EveryCmdSentinelIsPinned(t *testing.T) {
	pinned := map[string]bool{}
	for _, s := range sentinels {
		pinned[s.name] = true
	}

	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatalf("glob: %v", err)
	}
	ref := regexp.MustCompile(`\bapp\.(Err[A-Za-z]+)\b`)
	missing := map[string]string{}
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		src, err := os.ReadFile(f)
		if err != nil {
			t.Fatalf("read %s: %v", f, err)
		}
		for _, m := range ref.FindAllStringSubmatch(string(src), -1) {
			if !pinned[m[1]] {
				missing[m[1]] = f
			}
		}
	}
	if len(missing) > 0 {
		names := make([]string, 0, len(missing))
		for n := range missing {
			names = append(names, n+" ("+missing[n]+")")
		}
		sort.Strings(names)
		t.Errorf("pkg/cmd references %d sentinel(s) the ladder does not pin: %s\n"+
			"Add them to the sentinels table — an unpinned sentinel can lose its "+
			"identity in a carve and silently become a 500.", len(missing), strings.Join(names, ", "))
	}
}
