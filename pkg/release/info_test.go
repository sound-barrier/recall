package release_test

import (
	"strings"
	"testing"
	"unicode/utf8"

	"recall/pkg/gamedata"
	"recall/pkg/release"
)

// The dev-build × available matrix, reachable as a plain table now that
// InfoFor takes the version and the fetched meta instead of reading a
// package-level var behind an HTTP round trip.

// infoShape is the projection the matrix asserts on: the five fields the
// About dialog branches on. Comparing the projection rather than field by
// field keeps every row a single equality.
type infoShape struct {
	checked, devBuild, available bool
	latest, url                  string
}

func shapeOf(u release.Info) infoShape {
	return infoShape{u.Checked, u.DevBuild, u.Available, u.Latest, u.URL}
}

// The meta every matrix row is handed, and the two fields every arm must
// pass through untouched.
const (
	matrixStamp = "2026-08-15T12:00:00Z"
	matrixNotes = "* fixed the thing"
)

type infoForCase struct {
	name    string
	version string
	isDev   bool
	meta    release.Meta
	want    infoShape
}

func infoForCases() []infoForCase {
	meta := func(latest string) release.Meta {
		return release.Meta{
			Latest: latest, URL: "https://example/" + latest,
			Notes: matrixNotes, LastChecked: matrixStamp,
		}
	}
	return []infoForCase{{
		name: "dev build with a newer upstream reports it as context, never an upgrade",
		// The whole point of the DevBuild arm: Latest and URL survive so
		// the dialog can link the release, but Available stays false.
		version: "0.2.0", isDev: true, meta: meta("0.3.0"),
		want: infoShape{checked: true, devBuild: true, latest: "0.3.0", url: "https://example/0.3.0"},
	}, {
		name:    "dev build level with upstream still reports the tag",
		version: "0.3.0", isDev: true, meta: meta("0.3.0"),
		want: infoShape{checked: true, devBuild: true, latest: "0.3.0", url: "https://example/0.3.0"},
	}, {
		name:    "dev build ahead of upstream still reports the tag",
		version: "0.4.0", isDev: true, meta: meta("0.3.0"),
		want: infoShape{checked: true, devBuild: true, latest: "0.3.0", url: "https://example/0.3.0"},
	}, {
		name:    "release behind upstream is an upgrade",
		version: "0.2.0", isDev: false, meta: meta("0.3.0"),
		want: infoShape{checked: true, available: true, latest: "0.3.0", url: "https://example/0.3.0"},
	}, {
		name: "release level with upstream discards the tag",
		// Not incidental: the up-to-date arm deliberately blanks Latest
		// and URL so the frontend has nothing to render a link from.
		version: "0.3.0", isDev: false, meta: meta("0.3.0"),
		want: infoShape{checked: true},
	}, {
		name:    "release ahead of upstream is not a downgrade prompt",
		version: "0.4.0", isDev: false, meta: meta("0.3.0"),
		want: infoShape{checked: true},
	}, {
		name: "unparseable current version falls back to string equality",
		// The documented fallback: neither side parses as semver, so the
		// comparison degrades to "are these strings different?".
		version: "not-a-version", isDev: false, meta: meta("not-a-version"),
		want: infoShape{checked: true},
	}, {
		name:    "unparseable current version differing from upstream is an upgrade",
		version: "not-a-version", isDev: false, meta: meta("0.3.0"),
		want: infoShape{checked: true, available: true, latest: "0.3.0", url: "https://example/0.3.0"},
	}, {
		name:    "unparseable upstream tag differing from current is an upgrade",
		version: "0.3.0", isDev: false, meta: meta("nightly"),
		want: infoShape{checked: true, available: true, latest: "nightly", url: "https://example/nightly"},
	}}
}

func TestInfoFor_Matrix(t *testing.T) {
	withDeadRosterFetch(t)

	for _, c := range infoForCases() {
		t.Run(c.name, func(t *testing.T) {
			got := release.InfoFor(c.version, c.isDev, c.meta)

			if shapeOf(got) != c.want {
				t.Errorf("InfoFor(%q, isDev=%v, latest=%q) = %+v, want %+v",
					c.version, c.isDev, c.meta.Latest, shapeOf(got), c.want)
			}
			// Every one of the five return sites has to carry these two
			// through; a new arm that forgets one silently empties the
			// modal's release notes or restarts the banner cycle.
			if got.LastCheckedAt != matrixStamp {
				t.Errorf("LastCheckedAt: got %q, want %q — this arm drops the stamp", got.LastCheckedAt, matrixStamp)
			}
			if got.ReleaseNotes != matrixNotes {
				t.Errorf("ReleaseNotes: got %q, want %q — this arm drops the excerpt", got.ReleaseNotes, matrixNotes)
			}
		})
	}
}

// The truncation boundary, which was previously reachable only by staging
// a release body on an httptest server and reading the excerpt back out of
// a whole UpdateInfo.
func TestExcerptNotes_TruncationBoundary(t *testing.T) {
	const maxBytes = 500

	cases := []struct {
		name string
		body string
		want string
	}{{
		name: "empty body stays empty",
		body: "", want: "",
	}, {
		name: "short body passes through untouched",
		body: "## 1.2.0\n\n* one bullet", want: "## 1.2.0\n\n* one bullet",
	}, {
		name: "surrounding whitespace is trimmed before the length test",
		body: "  \n\ttrimmed\n  ", want: "trimmed",
	}, {
		name: "exactly at the cap is not elided",
		// The `<=` boundary. An off-by-one here appends an ellipsis to a
		// body that was never truncated.
		body: strings.Repeat("a", maxBytes), want: strings.Repeat("a", maxBytes),
	}, {
		name: "one byte past the cap is elided",
		body: strings.Repeat("a", maxBytes+1), want: strings.Repeat("a", maxBytes) + "…",
	}, {
		name: "whitespace at the cut is stripped before the ellipsis",
		body: strings.Repeat("a", maxBytes-5) + strings.Repeat(" ", 5) + strings.Repeat("b", 100),
		want: strings.Repeat("a", maxBytes-5) + "…",
	}}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := release.ExcerptNotes(c.body); got != c.want {
				t.Errorf("ExcerptNotes(%d bytes) = %q, want %q", len(c.body), got, c.want)
			}
		})
	}
}

// The rune-boundary walk-back, asserted as a property rather than a
// literal: whatever the cut lands on, the excerpt must still be valid
// UTF-8. A byte-exact cut splits the glyph and the modal renders U+FFFD.
func TestExcerptNotes_NeverSplitsAMultiByteRune(t *testing.T) {
	// 498 ASCII bytes then a 4-byte emoji spanning indices 498..501, so
	// the naive 500-byte cut lands mid-glyph.
	body := strings.Repeat("a", 498) + "😀" + strings.Repeat("b", 200)

	got := release.ExcerptNotes(body)

	if !utf8.ValidString(got) {
		t.Fatalf("excerpt is not valid UTF-8: %q", got)
	}
	if strings.ContainsRune(got, utf8.RuneError) {
		t.Errorf("excerpt contains U+FFFD — the cut split a glyph: %q", got)
	}
	if want := strings.Repeat("a", 498) + "…"; got != want {
		t.Errorf("excerpt = %q, want the walk-back to drop the whole glyph (%q)", got, want)
	}
}

// withDeadRosterFetch points the release-asset walk at a pre-closed
// server so the "available" arms of the matrix stay in-process. InfoFor
// fetches the upstream rosters on exactly that branch; every fetch fails
// fast and the roster lists come back empty, which is the documented
// asset-unavailable behavior.
func withDeadRosterFetch(t *testing.T) {
	t.Helper()
	dead := closedServerURL(t)
	prevAsset, prevList := gamedata.ReleaseAssetURL, gamedata.ReleaseListURL
	gamedata.ReleaseAssetURL = func(_, name string) string { return dead + "/" + name }
	gamedata.ReleaseListURL = dead
	t.Cleanup(func() {
		gamedata.ReleaseAssetURL = prevAsset
		gamedata.ReleaseListURL = prevList
	})
}
