package bundle_test

import (
	"strings"
	"testing"

	"recall/pkg/bundle"
)

// bundleParts is a bundle taken apart so one validation case can change exactly
// one thing. A nil manifest or data means "leave that file out of the ZIP".
type bundleParts struct {
	manifest map[string]any
	data     map[string]any
	shots    map[string][]byte
	extra    []zipEntry
}

// consistentParts is a bundle in which the manifest, data.json, and the
// screenshots/ contents all agree — the state Validate must report as clean.
func consistentParts() bundleParts {
	return bundleParts{
		manifest: map[string]any{
			"schema": bundleSchemaV1, "recall_version": seededVersion,
			"match_count": 1, "screenshot_count": 1,
			"screenshots": map[string]string{"a.png": "m1"},
		},
		data: map[string]any{
			"schema":    dataSchemaV2,
			"summaries": []map[string]any{{"Filename": "a.png", "MatchKey": "m1"}},
		},
		shots: map[string][]byte{"a.png": []byte("png")},
	}
}

func zipParts(t *testing.T, p bundleParts) []byte {
	t.Helper()
	entries := make([]zipEntry, 0, len(p.shots)+len(p.extra)+2)
	if p.manifest != nil {
		entries = append(entries, jsonFileEntry(t, "manifest.json", p.manifest))
	}
	if p.data != nil {
		entries = append(entries, jsonFileEntry(t, "data.json", p.data))
	}
	for _, name := range sortedKeys(p.shots) {
		entries = append(entries, fileEntry("screenshots/"+name, p.shots[name]))
	}
	return buildZip(t, append(entries, p.extra...)...)
}

// validationCase mutates the consistent bundle in exactly one way and declares
// the COMPLETE issue list Validate must produce for it. Exact lists, not
// presence checks: a spurious second finding costs a user an afternoon chasing
// a bundle that was fine, and only an exact list catches one.
type validationCase struct {
	name   string
	mutate func(*bundleParts)
	want   []string
}

func runValidationCases(t *testing.T, cases []validationCase) {
	t.Helper()
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			parts := consistentParts()
			tc.mutate(&parts)
			issues, err := bundle.Validate(zipParts(t, parts))
			if err != nil {
				t.Fatalf("Validate: %v", err)
			}
			assertIssueKinds(t, issues, tc.want)
		})
	}
}

// What the bundle claims to be, and whether its two core files are there at
// all. The `want` lists are ordered, which also pins the stable
// Kind-then-Message sort the CLI report depends on — including on the
// missing-core-file bail-out path.
func TestValidate_PresenceAndSchemaIssues(t *testing.T) {
	runValidationCases(t, []validationCase{
		{"consistent bundle", func(*bundleParts) {}, nil},
		{
			"data.json from the v1 era is still valid",
			func(p *bundleParts) { p.data["schema"] = dataSchemaV1 },
			nil,
		},
		{
			// Some archivers emit explicit directory entries; counting one
			// as a screenshot would flag every such bundle as an orphan.
			"a screenshots/ directory entry is not a screenshot",
			func(p *bundleParts) { p.extra = append(p.extra, fileEntry("screenshots/", nil)) },
			nil,
		},
		{
			"manifest.json missing stops the cross-checks",
			func(p *bundleParts) { p.manifest = nil },
			[]string{bundle.IssueMissingManifest},
		},
		{
			"data.json missing stops the cross-checks",
			func(p *bundleParts) { p.data = nil },
			[]string{bundle.IssueMissingData},
		},
		{
			"both core files missing",
			func(p *bundleParts) { p.manifest, p.data = nil, nil },
			[]string{bundle.IssueMissingData, bundle.IssueMissingManifest},
		},
		{
			"manifest from a newer bundle layout",
			func(p *bundleParts) { p.manifest["schema"] = "recall-bundle/v2" },
			[]string{bundle.IssueWrongManifestSchema},
		},
		{
			"data.json from a newer export schema",
			func(p *bundleParts) { p.data["schema"] = "recall-export/v9" },
			[]string{bundle.IssueWrongDataSchema},
		},
	})
}

// Whether the manifest, data.json, and the screenshots/ contents still describe
// each other — the checks that catch a bundle assembled or edited by hand.
func TestValidate_CrossReferenceIssues(t *testing.T) {
	runValidationCases(t, []validationCase{
		{
			"match_count disagrees with data.json's distinct keys",
			func(p *bundleParts) { p.manifest["match_count"] = 5 },
			[]string{bundle.IssueMatchCountMismatch},
		},
		{
			"screenshot_count disagrees with the manifest's own map",
			func(p *bundleParts) { p.manifest["screenshot_count"] = 9 },
			[]string{bundle.IssueScreenshotCountMismatch},
		},
		{
			"manifest lists a screenshot the ZIP doesn't carry",
			func(p *bundleParts) {
				p.manifest["screenshots"] = map[string]string{"a.png": "m1", "gone.png": "m1"}
				p.manifest["screenshot_count"] = 2
			},
			[]string{bundle.IssueManifestMissingFile, bundle.IssueScreenshotCountMismatch},
		},
		{
			"screenshots the manifest never mentions",
			func(p *bundleParts) {
				p.shots["b2.png"] = []byte("png")
				p.shots["b1.png"] = []byte("png")
			},
			[]string{bundle.IssueOrphanScreenshotFile, bundle.IssueOrphanScreenshotFile, bundle.IssueScreenshotCountMismatch},
		},
		{
			"manifest points a screenshot at a match_key data.json never mentions",
			func(p *bundleParts) { p.manifest["screenshots"] = map[string]string{"a.png": "ghost"} },
			[]string{bundle.IssueManifestKeyNotInData},
		},
		{
			"data.json references a file the manifest doesn't list",
			func(p *bundleParts) {
				p.data["summaries"] = []map[string]any{
					{"Filename": "a.png", "MatchKey": "m1"},
					{"Filename": "extra.png", "MatchKey": "m1"},
				}
			},
			[]string{bundle.IssueDataFileNotInManifest},
		},
		{
			// The path map is stripped on export precisely because it names
			// the user's home directory; a bundle carrying it is not shareable.
			"data.json still carries the screenshots_dirs path map",
			func(p *bundleParts) {
				p.data["screenshots_dirs"] = map[string]string{"1": `C:\Users\jacob\Pictures`}
			},
			[]string{bundle.IssueScreenshotsDirsLeak},
		},
	})
}

func assertIssueKinds(t *testing.T, got []bundle.Issue, want []string) {
	t.Helper()
	kinds := make([]string, 0, len(got))
	for _, i := range got {
		kinds = append(kinds, i.Kind)
	}
	if strings.Join(kinds, ",") != strings.Join(want, ",") {
		t.Fatalf("issue kinds = %v, want %v\nfull: %+v", kinds, want, got)
	}
}

// Two findings of the same kind tie-break on the message, so the CLI's report
// doesn't reshuffle between runs over the same file.
func TestValidate_SameKindIssuesSortByMessage(t *testing.T) {
	parts := consistentParts()
	parts.shots["z-orphan.png"] = []byte("png")
	parts.shots["b-orphan.png"] = []byte("png")

	issues, err := bundle.Validate(zipParts(t, parts))
	if err != nil {
		t.Fatalf("Validate: %v", err)
	}
	var orphans []string
	for _, i := range issues {
		if i.Kind == bundle.IssueOrphanScreenshotFile {
			orphans = append(orphans, i.Message)
		}
	}
	if len(orphans) != 2 {
		t.Fatalf("orphan issues = %v, want 2", orphans)
	}
	if orphans[0] >= orphans[1] {
		t.Errorf("orphan messages out of order: %q then %q", orphans[0], orphans[1])
	}
}

// A structurally broken bundle is an error, not a finding: there is nothing to
// report issues ABOUT, and returning an empty issue list would read as "clean".
func TestValidate_StructuralBreakageIsAnErrorNotAFinding(t *testing.T) {
	for _, tc := range structuralBreakageCases() {
		t.Run(tc.name, func(t *testing.T) {
			issues, err := bundle.Validate(tc.payload(t))
			if err == nil {
				t.Fatalf("Validate returned %d issues and no error", len(issues))
			}
			if !strings.Contains(err.Error(), tc.wantMsg) {
				t.Fatalf("err = %q, want it to mention %q", err, tc.wantMsg)
			}
			if issues != nil {
				t.Error("a structural failure must not also hand back issues")
			}
		})
	}
}

func structuralBreakageCases() []rejectCase {
	return []rejectCase{
		{
			name:    "not an archive",
			payload: func(*testing.T) []byte { return []byte("PK\x03\x04 truncated") },
			wantMsg: "parse zip:",
		},
		{
			name: "manifest.json is not JSON",
			payload: func(t *testing.T) []byte {
				t.Helper()
				p := consistentParts()
				return buildZip(t, fileEntry("manifest.json", []byte("{")), jsonFileEntry(t, "data.json", p.data))
			},
			wantMsg: "decode manifest.json:",
		},
		{
			name: "data.json is not JSON",
			payload: func(t *testing.T) []byte {
				t.Helper()
				p := consistentParts()
				return buildZip(t, jsonFileEntry(t, "manifest.json", p.manifest), fileEntry("data.json", []byte("[")))
			},
			wantMsg: "decode data.json:",
		},
		{
			name: "data.json declares an unsupported compression algorithm",
			payload: func(t *testing.T) []byte {
				t.Helper()
				p := consistentParts()
				return buildZip(t,
					jsonFileEntry(t, "manifest.json", p.manifest),
					zipEntry{name: "data.json", body: mustJSON(t, p.data), method: 99, raw: true},
				)
			},
			wantMsg: "read data.json:",
		},
		{
			name: "manifest.json declares an unsupported compression algorithm",
			payload: func(t *testing.T) []byte {
				t.Helper()
				p := consistentParts()
				return buildZip(t,
					zipEntry{name: "manifest.json", body: mustJSON(t, p.manifest), method: 99, raw: true},
					jsonFileEntry(t, "data.json", p.data),
				)
			},
			wantMsg: "read manifest.json:",
		},
	}
}

// The exporter and the validator have to agree, or the tool ships bundles its
// own bug-finder rejects. Both halves are pinned: a complete export is clean,
// and the one acknowledged asymmetry — a row whose screenshot has been deleted
// from disk still ships, so the manifest can no longer list its file — is
// reported as exactly that, and nothing more.
func TestValidate_AgreesWithExport(t *testing.T) {
	shots := t.TempDir()
	store := seededStore(t, shots)
	writeShots(t, shots, append(seededParentFiles(), "unknown-3.png")...)
	opts := bundle.ExportBundleOptions{MatchKeys: seededKeys()}

	payload, err := bundle.Export(store, opts, nil, shots, seededVersion)
	if err != nil {
		t.Fatalf("Export: %v", err)
	}
	issues, err := bundle.Validate(payload)
	if err != nil {
		t.Fatalf("Validate: %v", err)
	}
	assertIssueKinds(t, issues, nil)

	if err := removeShot(shots, "unknown-3.png"); err != nil {
		t.Fatalf("remove: %v", err)
	}
	payload, err = bundle.Export(store, opts, nil, shots, seededVersion)
	if err != nil {
		t.Fatalf("Export after delete: %v", err)
	}
	issues, err = bundle.Validate(payload)
	if err != nil {
		t.Fatalf("Validate after delete: %v", err)
	}
	assertIssueKinds(t, issues, []string{bundle.IssueDataFileNotInManifest})
}
