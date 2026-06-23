package app

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/Masterminds/semver/v3"

	"recall/pkg/applog"
)

// Version is injected at build time via -ldflags "-X recall/pkg/app.Version=<tag>".
// Falls back to "dev" when building outside the release pipeline.
var Version = "dev"

// UpdateInfo is returned by CheckForUpdate.
//
//   - Checked=false: dev build skipped, or network failure — show nothing.
//   - Checked=true, DevBuild=true: show "Latest: vX" link (informational).
//   - Checked=true, DevBuild=false, Available=true: show "↑ vX available" link.
//   - Checked=true, DevBuild=false, Available=false: show "✓ most recent".
//
// LatestHeroes / LatestMaps carry the canonical display-name lists
// extracted from the release's `recall-<version>-heroes.yaml` and
// `recall-<version>-maps.yaml` assets. The frontend pivots these into
// a "Update to v<X> to recognise <name>" CTA on the Reference data
// gaps section so the user knows which OCR-captured names are about
// to be recognised once they update. Empty when the YAML fetch fails
// or the sidecar SHA-256 check rejects the asset — Recall keeps
// showing the generic "wait for the next release" copy in that case.
type UpdateInfo struct {
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
	// successful CheckForUpdate response, persisted to
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
	GameData GameDataStatus `json:"game_data"`
}

// releasesURL is the GitHub Releases API endpoint CheckForUpdate
// queries. Exposed as a package-level var so tests can substitute an
// httptest.NewServer URL — production code never reassigns it.
// Pattern matches parser.runTesseractFunc / parseSingleFunc per
// CLAUDE.md's function-variable-seam guidance for single-method
// dependencies.
var releasesURL = "https://api.github.com/repos/sound-barrier/recall/releases/latest"

func (a *App) GetVersion() string {
	if Version != "dev" {
		return Version
	}
	// No ldflags injection (direct `wails dev` or similar): read the manifest
	// so the UI shows "<version>-dev" rather than a bare "dev".
	data, err := os.ReadFile(".release-please-manifest.json")
	if err != nil {
		return "dev"
	}
	var manifest map[string]string
	if err := json.Unmarshal(data, &manifest); err != nil {
		return "dev"
	}
	if v := manifest["."]; v != "" {
		return v + "-dev"
	}
	return "dev"
}

// CheckForUpdate hits the GitHub releases API and compares the latest stable
// release against the running version. The caller should invoke this off the
// hot path — it makes a network request with a 5 s timeout.
//
// Dev builds (version ending in "-dev" or bare "dev") always report the
// latest release as informational context (DevBuild=true) rather than an
// upgrade prompt. Network failures return an empty UpdateInfo.
//
// On every successful API response (including "up to date" + dev-build
// branches), the install's last-checked timestamp is persisted via
// TouchLastChecked so the "haven't checked in a while" banner has a
// canonical source of truth.
func (a *App) CheckForUpdate() UpdateInfo {
	v := a.GetVersion()
	isDev := v == "dev" || strings.HasSuffix(v, "-dev")

	// Fire the game-data (main-channel) fetch in parallel with the
	// release-channel binary-version fetch — they hit independent
	// hosts (api.github.com vs sound-barrier.github.io) so serial
	// would double the latency for no benefit. Joined at the end on
	// success, or drained on the failure path so the goroutine never
	// leaks; failures collapse to GameDataStatus{} which the FE
	// renders as "main channel unavailable".
	gameDataChan := startGameDataFetch()

	meta, ok := fetchLatestReleaseMeta()
	if !ok {
		<-gameDataChan
		return UpdateInfo{}
	}
	u := updateInfoFor(v, isDev, meta)
	u.GameData = <-gameDataChan
	return u
}

// startGameDataFetch kicks off the main-channel roster/version probe on a
// background goroutine, returning the channel its single result lands on.
func startGameDataFetch() chan GameDataStatus {
	ch := make(chan GameDataStatus, 1)
	go func() {
		ver := fetchMainVersion()
		mh, mm, ms := fetchMainRosters()
		ch <- computeGameDataStatus(ver, mh, mm, ms)
	}()
	return ch
}

// releaseMeta is the slice of the GitHub release the update check needs.
type releaseMeta struct {
	latest      string
	url         string
	notes       string
	lastChecked string
}

// fetchLatestReleaseMeta GETs the latest release, decodes it, and records
// the last-checked timestamp. ok=false on any network/decode failure or an
// empty tag — the caller collapses that to an empty UpdateInfo.
func fetchLatestReleaseMeta() (releaseMeta, bool) {
	client := newUpdateClient()
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, releasesURL, nil)
	if err != nil {
		return releaseMeta{}, false
	}
	resp, err := client.Do(req)
	if err != nil {
		return releaseMeta{}, false
	}
	defer func() { _ = resp.Body.Close() }()

	var release struct {
		TagName string `json:"tag_name"`
		HTMLURL string `json:"html_url"`
		Body    string `json:"body"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return releaseMeta{}, false
	}
	latest := strings.TrimPrefix(release.TagName, "v")
	if latest == "" {
		return releaseMeta{}, false
	}

	now := time.Now().UTC()
	if err := TouchLastChecked(now); err != nil {
		applog.Subsystem("update").Warn("persist last-checked timestamp failed", "err", err)
	}
	return releaseMeta{
		latest:      latest,
		url:         release.HTMLURL,
		notes:       excerptReleaseNotes(release.Body),
		lastChecked: now.Format(time.RFC3339),
	}, true
}

// updateInfoFor turns the current version + fetched release meta into the
// UpdateInfo (minus GameData, which the caller joins). Dev builds report
// DevBuild; otherwise a semver compare decides Available.
func updateInfoFor(v string, isDev bool, m releaseMeta) UpdateInfo {
	if isDev {
		return UpdateInfo{
			Checked:       true,
			DevBuild:      true,
			Latest:        m.latest,
			URL:           m.url,
			LastCheckedAt: m.lastChecked,
			ReleaseNotes:  m.notes,
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
	upstream, errUpstream := semver.NewVersion(m.latest)
	if errCurrent != nil || errUpstream != nil {
		if m.latest == v {
			return UpdateInfo{Checked: true, LastCheckedAt: m.lastChecked, ReleaseNotes: m.notes}
		}
		return UpdateInfo{
			Checked:       true,
			Available:     true,
			Latest:        m.latest,
			URL:           m.url,
			LastCheckedAt: m.lastChecked,
			ReleaseNotes:  m.notes,
		}
	}

	if !current.LessThan(upstream) {
		return UpdateInfo{Checked: true, LastCheckedAt: m.lastChecked, ReleaseNotes: m.notes}
	}
	heroes, maps, sources := fetchReleaseRosters(m.latest)
	return UpdateInfo{
		Checked:       true,
		Available:     true,
		Latest:        m.latest,
		URL:           m.url,
		LatestHeroes:  heroes,
		LatestMaps:    maps,
		LatestSources: sources,
		LastCheckedAt: m.lastChecked,
		ReleaseNotes:  m.notes,
	}
}

// releaseNotesMaxBytes caps the body excerpt surfaced into the modal.
// The release-notes section is interpolated into a Vue template
// (auto-escaped, never v-html) and rendered behind a "more on GitHub"
// link — 500 chars is enough headroom for one paragraph + a few
// bullet points without crowding out the diff section.
const releaseNotesMaxBytes = 500

// excerptReleaseNotes returns up to releaseNotesMaxBytes worth of the
// release body. Truncation breaks on a rune boundary so a multi-byte
// glyph can never split mid-codepoint. Trailing whitespace stripped.
func excerptReleaseNotes(body string) string {
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
