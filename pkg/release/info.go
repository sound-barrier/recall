package release

import (
	"strings"

	"github.com/Masterminds/semver/v3"

	"recall/pkg/gamedata"
)

// Info is the result of an update Check, and the wire shape the API
// serves.
//
//   - Checked=false: dev build skipped, or network failure — show nothing.
//   - Checked=true, DevBuild=true: show "Latest: vX" link (informational).
//   - Checked=true, DevBuild=false, Available=true: show "↑ vX available" link.
//   - Checked=true, DevBuild=false, Available=false: show "✓ most recent".
//
// LatestHeroes / LatestMaps carry the canonical display-name lists
// extracted from the release's `recall-<version>-heroes.yaml` and
// `recall-<version>-maps.yaml` assets. The frontend pivots these into
// a "Update to v<X> to recognize <name>" CTA on the Reference data
// gaps section so the user knows which OCR-captured names are about
// to be recognized once they update. Empty when the YAML fetch fails
// or the sidecar SHA-256 check rejects the asset — Recall keeps
// showing the generic "wait for the next release" copy in that case.
type Info struct {
	Checked      bool     `json:"checked"`
	DevBuild     bool     `json:"dev_build"`
	Available    bool     `json:"available"`
	Latest       string   `json:"latest"`
	URL          string   `json:"url"`
	LatestHeroes []string `json:"latest_heroes,omitempty"`
	LatestMaps   []string `json:"latest_maps,omitempty"`

	// LatestSources is the screenshot-source name list extracted from
	// the release's `recall-<version>-screenshot_sources.yaml` asset.
	// Empty when the fetch fails or the SHA-256 sidecar rejects.
	LatestSources []string `json:"latest_sources,omitempty"`

	// LastCheckedAt records when this install last received a
	// successful Check response, persisted to
	// <RECALL_DATA_DIR>/check_state.json. Drives the "haven't checked
	// in a while" banner. RFC3339 / UTC.
	LastCheckedAt string `json:"last_checked_at,omitempty"`

	// ReleaseNotes is the first ~500 chars of the release's `body`
	// field, surfaced in the update-check modal. Markdown is passed
	// through unchanged; the FE escapes it via Vue's default
	// interpolation (never v-html).
	ReleaseNotes string `json:"release_notes,omitempty"`

	// GameData carries the comparison between the user's currently-
	// applied game data (heroes / maps / screenshot sources, per
	// <RECALL_DATA_DIR>/data/manifest.json — or "embedded" if missing)
	// and the live main channel published at
	// https://sound-barrier.github.io/recall/data/. Always populated
	// when the Pages fetch succeeded; empty CommitSHA means the Pages
	// fetch failed (network / Pages outage / invalid version.json) and
	// the FE shows a "main unreachable" state.
	GameData gamedata.Status `json:"game_data"`

	// CanSelfUpdate is true when this install can swap its own binary
	// in place (desktop Wails build, non-dev, non-macOS, writable exe).
	// The About dialog shows an "Install update" button only then;
	// otherwise it falls back to the "Open release page" link (server
	// mode, dev builds, macOS, and machine-wide Windows installs that
	// predate the per-user move). Set by the shell from
	// App.SelfUpdate != nil — this package cannot know it.
	CanSelfUpdate bool `json:"can_self_update"`
}

// InfoFor turns the current version + fetched release meta into the Info
// (minus GameData, which Check joins). Dev builds report DevBuild;
// otherwise a semver compare decides Available.
func InfoFor(v string, isDev bool, m Meta) Info {
	if isDev {
		return Info{
			Checked:       true,
			DevBuild:      true,
			Latest:        m.Latest,
			URL:           m.URL,
			LastCheckedAt: m.LastChecked,
			ReleaseNotes:  m.Notes,
		}
	}

	// Semver compare instead of raw string equality. Two reasons:
	//   1. The production binary's `Version` carries a leading `v`
	//      (release.yml passes `${{ github.ref_name }}` — the tag
	//      name — to the Dockerfile's ldflags), but local Taskfile
	//      builds get bare semver from the manifest. semver.NewVersion
	//      accepts both forms, so the comparison stops caring about
	//      the prefix-mismatch that pre-fix made every official
	//      install show a perpetual "upgrade to <your-own-version>"
	//      prompt.
	//   2. Lexicographic compare flags 0.2.10 != 0.2.9 and would
	//      prompt the user to "upgrade" from 10 to 9. semver.LessThan
	//      orders them correctly.
	// Parse failures fall back to raw string equality so a malformed
	// release tag on GitHub's side (or a hand-built binary with a
	// non-semver Version string) doesn't trip the "Available" flag
	// any more aggressively than the old code did.
	current, errCurrent := semver.NewVersion(v)
	upstream, errUpstream := semver.NewVersion(m.Latest)
	if errCurrent != nil || errUpstream != nil {
		if m.Latest == v {
			return Info{Checked: true, LastCheckedAt: m.LastChecked, ReleaseNotes: m.Notes}
		}
		return Info{
			Checked:       true,
			Available:     true,
			Latest:        m.Latest,
			URL:           m.URL,
			LastCheckedAt: m.LastChecked,
			ReleaseNotes:  m.Notes,
		}
	}

	if !current.LessThan(upstream) {
		return Info{Checked: true, LastCheckedAt: m.LastChecked, ReleaseNotes: m.Notes}
	}
	heroes, maps, sources := gamedata.FetchReleaseRosters(m.Latest)
	return Info{
		Checked:       true,
		Available:     true,
		Latest:        m.Latest,
		URL:           m.URL,
		LatestHeroes:  heroes,
		LatestMaps:    maps,
		LatestSources: sources,
		LastCheckedAt: m.LastChecked,
		ReleaseNotes:  m.Notes,
	}
}

// releaseNotesMaxBytes caps the body excerpt surfaced into the modal.
// The release-notes section is interpolated into a Vue template
// (auto-escaped, never v-html) and rendered behind a "more on GitHub"
// link — 500 chars is enough headroom for one paragraph + a few
// bullet points without crowding out the diff section.
const releaseNotesMaxBytes = 500

// ExcerptNotes returns up to releaseNotesMaxBytes worth of the release
// body. Truncation breaks on a rune boundary so a multi-byte glyph can
// never split mid-codepoint. Trailing whitespace stripped.
func ExcerptNotes(body string) string {
	body = strings.TrimSpace(body)
	if len(body) <= releaseNotesMaxBytes {
		return body
	}
	cut := releaseNotesMaxBytes
	for cut > 0 && (body[cut]&0xC0) == 0x80 {
		cut-- // walk back into the rune
	}
	return strings.TrimRight(body[:cut], " \t\n") + "…"
}
