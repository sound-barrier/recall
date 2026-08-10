package cmd_test

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"recall/pkg/db"
	"recall/pkg/db/dbtest"
)

// Request-body validation across the handlers that read the raw body
// themselves (rather than handing it straight to json.Decoder): the
// export-bundle field rules, and what a transport-level read failure
// looks like.

const exportBundlePath = "/api/v1/exports/bundle"

// The bundle body is the one place the spec's "no nulls" rule is
// enforced by hand — Go's decoder would turn `null` into an empty
// selection and export nothing while answering 200. Each case names the
// offending field in `detail` so a scripted caller can fix its payload.
// The two wrong-type cases assert only the field name — the rest of that
// detail is encoding/json's wording, which is not our contract.
func TestExportBundle_RejectsNullAndMistypedFields(t *testing.T) {
	cases := []struct {
		name, body, wantDetail string
	}{
		{"match_keys absent", `{}`, "match_keys is required"},
		{"match_keys null", `{"match_keys":null}`, "match_keys must be an array, not null"},
		{"match_keys member null", `{"match_keys":[null]}`, "match_keys[0] must be a string, not null"},
		{"match_keys not an array", `{"match_keys":"match-A"}`, "match_keys"},
		{"include_unknown null", `{"match_keys":[],"include_unknown":null}`, "include_unknown must be a boolean, not null"},
		{"include_hidden null", `{"match_keys":[],"include_hidden":null}`, "include_hidden must be a boolean, not null"},
		{"include_unknown not a boolean", `{"match_keys":[],"include_unknown":"yes"}`, "include_unknown"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, mux := newTestApp(t, dbtest.New())
			rec := postRaw(t, mux, exportBundlePath, tc.body)
			assertProblem(t, rec, http.StatusBadRequest, "invalid-body", tc.wantDetail)
		})
	}
}

// bundleMatchKeys returns the match_keys a bundle response actually
// carries, read back out of the zip's data.json.
func bundleMatchKeys(t *testing.T, body []byte) []string {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		t.Fatalf("response is not a zip: %v", err)
	}
	for _, f := range zr.File {
		if f.Name != "data.json" {
			continue
		}
		return summaryKeysFromEntry(t, f)
	}
	t.Fatal("bundle has no data.json")
	return nil
}

func summaryKeysFromEntry(t *testing.T, f *zip.File) []string {
	t.Helper()
	rc, err := f.Open()
	if err != nil {
		t.Fatalf("open data.json: %v", err)
	}
	defer func() { _ = rc.Close() }()
	// db.SummaryRow carries no json tags, so the wire keys are the Go
	// field names verbatim.
	var data struct {
		Summaries []struct{ MatchKey string } `json:"summaries"`
	}
	if err := json.NewDecoder(rc).Decode(&data); err != nil {
		t.Fatalf("decode data.json: %v", err)
	}
	keys := make([]string, 0, len(data.Summaries))
	for _, s := range data.Summaries {
		keys = append(keys, s.MatchKey)
	}
	slices.Sort(keys)
	return keys
}

// The two toggles are adjacent booleans of the same type on the wire and
// in the options struct, so a crossed wiring compiles and ships. Each
// one must pull in exactly its own category — and an empty selection
// with no toggles must export NOTHING, never the whole corpus.
func TestExportBundle_TogglesSelectTheirOwnCategoryOnly(t *testing.T) {
	cases := []struct {
		name, body string
		want       []string
	}{
		{"empty selection exports nothing", `{"match_keys":[]}`, nil},
		{"include_unknown adds the map-less match", `{"match_keys":[],"include_unknown":true}`, []string{"match-U"}},
		{"include_hidden adds the hidden match", `{"match_keys":[],"include_hidden":true}`, []string{"match-H"}},
		{"explicit key selects just that match", `{"match_keys":["match-H"]}`, []string{"match-H"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, mux := newTestApp(t, seededSelectionStore(t))
			rec := postRaw(t, mux, exportBundlePath, tc.body)
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body=%q", rec.Code, rec.Body.String())
			}
			if got := bundleMatchKeys(t, rec.Body.Bytes()); !slices.Equal(got, tc.want) {
				t.Errorf("bundle carries %v, want %v", got, tc.want)
			}
		})
	}
}

// seededSelectionStore holds one map-less ("unknown") match and one
// hidden match with a known map, so the two toggles are distinguishable.
func seededSelectionStore(t *testing.T) *dbtest.Fake {
	t.Helper()
	fs := dbtest.New()
	if err := fs.UpsertSummary(db.SummaryRow{Filename: "u.png", MatchKey: "match-U"}); err != nil {
		t.Fatalf("seed unknown: %v", err)
	}
	if err := fs.UpsertSummary(db.SummaryRow{Filename: "h.png", MatchKey: "match-H", Map: "rialto"}); err != nil {
		t.Fatalf("seed hidden: %v", err)
	}
	if err := fs.HideMatch("match-H"); err != nil {
		t.Fatalf("hide: %v", err)
	}
	return fs
}

// errReader fails on the first read — the shape a client that hangs up
// mid-upload presents to the handler.
type errReader struct{}

func (errReader) Read([]byte) (int, error) { return 0, errors.New("connection reset") }

// Handlers that read the body themselves must translate a transport
// read failure into a 400 problem naming it, not panic on the partial
// buffer or hand a truncated payload to the importer.
func TestUnreadableBody_IsBadRequestProblem(t *testing.T) {
	cases := []struct{ name, method, path string }{
		{"annotation", http.MethodPut, "/api/v1/matches/match-A/annotation"},
		{"match data", http.MethodPut, "/api/v1/matches/match-A/data"},
		{"database restore", http.MethodPut, "/api/v1/database"},
		{"bundle import", http.MethodPost, "/api/v1/imports"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, mux := newTestApp(t, dbtest.New())
			rec := fireBody(t, mux, tc.method, tc.path, errReader{})
			assertProblem(t, rec, http.StatusBadRequest, "invalid-body", "read body:")
		})
	}
}

// PUT /matches/{key}/data slurps the raw body first (so a literal
// `null` can be rejected) and only then unmarshals, which puts its
// malformed-JSON gate on a different branch from the decoder-based
// setters. A miss there hands a half-populated override struct to the
// store and answers 204.
func TestUpdateMatchData_MalformedJSONIsBadRequest(t *testing.T) {
	fs := dbtest.New()
	_, mux := newTestApp(t, fs)
	rec := putRaw(t, mux, "/api/v1/matches/match-A/data", `{"damage": }`)
	assertProblem(t, rec, http.StatusBadRequest, "invalid-body", "invalid JSON body")
	if len(fs.UserMatchData) != 0 {
		t.Errorf("malformed body must not reach the store: %v", fs.UserMatchData)
	}
}

// fireBody dispatches a request whose body is an arbitrary reader, so a
// test can supply one that fails mid-stream.
func fireBody(t *testing.T, mux *http.ServeMux, method, path string, body io.Reader) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), method, path, body)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}
