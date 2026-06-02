package app

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strings"
)

// BundleIssue is one discrepancy ValidateBundle found between the
// bundle's `manifest.json`, `data.json`, and `screenshots/` contents.
//
// `Kind` is a short stable identifier suitable for machine parsing
// (a future scripted invocation can grep on it). `Message` is the
// human-readable explanation suitable for the CLI report.
type BundleIssue struct {
	Kind    string `json:"kind"`
	Message string `json:"message"`
}

// Validation kinds. Stable across releases — callers can grep on
// these without re-parsing the message string.
const (
	IssueMissingManifest         = "missing_manifest"
	IssueMissingData             = "missing_data"
	IssueWrongManifestSchema     = "wrong_manifest_schema"
	IssueWrongDataSchema         = "wrong_data_schema"
	IssueMatchCountMismatch      = "match_count_mismatch"
	IssueScreenshotCountMismatch = "screenshot_count_mismatch"
	IssueManifestMissingFile     = "manifest_missing_screenshot_file"
	IssueOrphanScreenshotFile    = "orphan_screenshot_file"
	IssueManifestKeyNotInData    = "manifest_key_not_in_data"
	IssueDataFileNotInManifest   = "data_file_not_in_manifest"
	IssueScreenshotsDirsLeak     = "screenshots_dirs_leak"
)

// ValidateBundle parses a Recall export bundle (the `.zip` produced
// by ExportBundle) and reports every consistency mismatch between
// the three pieces:
//
//   - `manifest.json`: provenance + the screenshot → match_key map
//   - `data.json`:     the `recall-export/v1` row tables
//   - `screenshots/`:  the on-disk image bytes
//
// Returns a non-nil error only when the ZIP itself can't be parsed
// or one of the JSON files is structurally broken. A well-formed
// bundle with logical issues returns `(issues, nil)` — callers
// distinguish by checking `len(issues)`.
//
// Validations:
//
//  1. manifest.json + data.json are both present
//  2. manifest.schema == BundleSchemaV1
//  3. data.schema     == exportSchemaV1
//  4. manifest.match_count matches the distinct match_key set
//     derived from the manifest's screenshots map AND data.json's
//     row tables (they must agree)
//  5. manifest.screenshot_count matches the actual count of files
//     under `screenshots/` AND len(manifest.screenshots)
//  6. every key in manifest.screenshots has a file at
//     `screenshots/<key>` in the ZIP
//  7. every file at `screenshots/<...>` has a key in
//     manifest.screenshots
//  8. every match_key referenced in manifest.screenshots has at
//     least one row in data.json's tables
//  9. every row in data.json whose `Filename` is non-empty has a
//     key in manifest.screenshots
//  10. data.json does NOT carry `screenshots_dirs` (the PII path
//     map was intentionally stripped — bundles must be sanitized)
func ValidateBundle(zipBytes []byte) ([]BundleIssue, error) {
	zr, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
	if err != nil {
		return nil, fmt.Errorf("parse zip: %w", err)
	}

	var issues []BundleIssue
	add := func(kind, msg string) {
		issues = append(issues, BundleIssue{Kind: kind, Message: msg})
	}

	var (
		manifestBytes []byte
		dataBytes     []byte
		screenshots   = map[string]struct{}{} // basename-only set under screenshots/
	)
	for _, f := range zr.File {
		switch {
		case f.Name == "manifest.json":
			manifestBytes, err = readZipEntry(f)
			if err != nil {
				return nil, fmt.Errorf("read manifest.json: %w", err)
			}
		case f.Name == "data.json":
			dataBytes, err = readZipEntry(f)
			if err != nil {
				return nil, fmt.Errorf("read data.json: %w", err)
			}
		case strings.HasPrefix(f.Name, "screenshots/") && !strings.HasSuffix(f.Name, "/"):
			screenshots[strings.TrimPrefix(f.Name, "screenshots/")] = struct{}{}
		}
	}

	if manifestBytes == nil {
		add(IssueMissingManifest, "manifest.json is missing from the bundle ZIP")
	}
	if dataBytes == nil {
		add(IssueMissingData, "data.json is missing from the bundle ZIP")
	}
	// If either core file is gone, the rest of the validation can't
	// run meaningfully. Bail with what we have.
	if manifestBytes == nil || dataBytes == nil {
		return issues, nil
	}

	var mf BundleManifestV1
	if err := json.Unmarshal(manifestBytes, &mf); err != nil {
		return nil, fmt.Errorf("decode manifest.json: %w", err)
	}
	if mf.Schema != BundleSchemaV1 {
		add(IssueWrongManifestSchema,
			fmt.Sprintf("manifest.schema = %q, want %q", mf.Schema, BundleSchemaV1))
	}

	// data.json — strict decode + a tolerant decode for the residual
	// `screenshots_dirs` field. We unmarshal twice (cheap; the file
	// is small) so we can both populate typed row slices AND probe
	// for the leak.
	var dataDoc BundleDataV1
	if err := json.Unmarshal(dataBytes, &dataDoc); err != nil {
		return nil, fmt.Errorf("decode data.json: %w", err)
	}
	if dataDoc.Schema != exportSchemaV1 {
		add(IssueWrongDataSchema,
			fmt.Sprintf("data.schema = %q, want %q", dataDoc.Schema, exportSchemaV1))
	}
	var dataProbe struct {
		ScreenshotsDirs map[string]string `json:"screenshots_dirs"`
	}
	if err := json.Unmarshal(dataBytes, &dataProbe); err == nil && len(dataProbe.ScreenshotsDirs) > 0 {
		add(IssueScreenshotsDirsLeak,
			fmt.Sprintf("data.json carries screenshots_dirs (%d entries) — bundles must omit the path map",
				len(dataProbe.ScreenshotsDirs)))
	}

	// data.json is the canonical "what's in the bundle" payload;
	// derive its distinct match_key set so we can cross-check
	// manifest.match_count + validate every manifest entry against
	// it (validation 8).
	dataKeys := dataMatchKeys(dataDoc)

	// Validation 4: manifest.match_count vs distinct match_keys
	// present in data.json's rows. We compare against data.json's
	// derived set because data.json is the canonical "what's in the
	// bundle" payload; manifest.match_count is the audit declaration.
	if len(dataKeys) != mf.MatchCount {
		add(IssueMatchCountMismatch,
			fmt.Sprintf("manifest.match_count = %d, data.json has %d distinct match_keys",
				mf.MatchCount, len(dataKeys)))
	}

	// Validation 5: screenshot_count agreement.
	switch {
	case mf.ScreenshotCount != len(mf.Screenshots):
		add(IssueScreenshotCountMismatch,
			fmt.Sprintf("manifest.screenshot_count = %d, manifest.screenshots has %d entries",
				mf.ScreenshotCount, len(mf.Screenshots)))
	case len(mf.Screenshots) != len(screenshots):
		add(IssueScreenshotCountMismatch,
			fmt.Sprintf("manifest.screenshots has %d entries, screenshots/ has %d files",
				len(mf.Screenshots), len(screenshots)))
	}

	// Validations 6 + 7: bidirectional screenshot ↔ file map.
	for filename := range mf.Screenshots {
		if _, ok := screenshots[filename]; !ok {
			add(IssueManifestMissingFile,
				fmt.Sprintf("manifest lists %q but the file is not in screenshots/", filename))
		}
	}
	for filename := range screenshots {
		if _, ok := mf.Screenshots[filename]; !ok {
			add(IssueOrphanScreenshotFile,
				fmt.Sprintf("screenshots/%s exists but isn't listed in the manifest", filename))
		}
	}

	// Validation 8: every manifest match_key must have at least one
	// row in data.json.
	for filename, mk := range mf.Screenshots {
		if _, ok := dataKeys[mk]; !ok {
			add(IssueManifestKeyNotInData,
				fmt.Sprintf("manifest maps %q → %q but no row in data.json carries that match_key",
					filename, mk))
		}
	}

	// Validation 9: every data.json row with a Filename must appear
	// in the manifest's screenshots map.
	for _, fn := range dataRowFilenames(dataDoc) {
		if _, ok := mf.Screenshots[fn]; !ok {
			add(IssueDataFileNotInManifest,
				fmt.Sprintf("data.json references %q but the manifest doesn't list that file",
					fn))
		}
	}

	// Stable issue order so the CLI output is deterministic.
	sort.SliceStable(issues, func(i, j int) bool {
		if issues[i].Kind == issues[j].Kind {
			return issues[i].Message < issues[j].Message
		}
		return issues[i].Kind < issues[j].Kind
	})
	return issues, nil
}

func readZipEntry(f *zip.File) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer func() { _ = rc.Close() }()
	return io.ReadAll(rc)
}

// dataMatchKeys returns the set of distinct match_keys referenced
// across every row table in data.json.
func dataMatchKeys(d BundleDataV1) map[string]struct{} {
	keys := map[string]struct{}{}
	for _, r := range d.Summaries {
		keys[r.MatchKey] = struct{}{}
	}
	for _, r := range d.Scoreboards {
		keys[r.MatchKey] = struct{}{}
	}
	for _, r := range d.Personals {
		keys[r.MatchKey] = struct{}{}
	}
	for _, r := range d.Ranks {
		keys[r.MatchKey] = struct{}{}
	}
	for _, r := range d.Unknowns {
		keys[r.MatchKey] = struct{}{}
	}
	return keys
}

// dataRowFilenames returns every non-empty `Filename` value across
// data.json's row tables.
func dataRowFilenames(d BundleDataV1) []string {
	out := make([]string, 0)
	push := func(name string) {
		if name != "" {
			out = append(out, name)
		}
	}
	for _, r := range d.Summaries {
		push(r.Filename)
	}
	for _, r := range d.Scoreboards {
		push(r.Filename)
	}
	for _, r := range d.Personals {
		push(r.Filename)
	}
	for _, r := range d.Ranks {
		push(r.Filename)
	}
	for _, r := range d.Unknowns {
		push(r.Filename)
	}
	return out
}
