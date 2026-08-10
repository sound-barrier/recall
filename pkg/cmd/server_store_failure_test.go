package cmd_test

import (
	"net/http"
	"testing"
	"testing/fstest"

	"recall/pkg/app"
	"recall/pkg/cmd"
	"recall/pkg/db"
)

// An unexpected store failure has exactly one wire shape: a 500
// application/problem+json with the `internal` type. The risk this pins
// is the opposite outcome — a write handler that drops its
// `if writeError(...) { return }` guard still answers 204, telling the
// UI a row was deleted or a flag was set when the database never saw it.
//
// The failure is injected honestly: a real *SQLStore that has been
// closed, which is what a yanked drive or a mid-session profile teardown
// looks like to every store call.

func newClosedStoreMux(t *testing.T) *http.ServeMux {
	t.Helper()
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	store, err := db.NewSQLStore(":memory:")
	if err != nil {
		t.Fatalf("NewSQLStore: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	a := app.NewWithStore(store)
	a.SSEHub = app.NewSSEHub()
	return cmd.NewMux(a, fstest.MapFS{})
}

func TestStoreFailure_WritesReportInternalProblemNotSuccess(t *testing.T) {
	cases := []struct {
		name, method, path string
		body               any
	}{
		{"hard delete", http.MethodDelete, "/api/v1/matches/match-A", nil},
		{"pin", http.MethodPut, "/api/v1/matches/match-A/pin", map[string]any{"pinned": true}},
		{"visibility", http.MethodPut, "/api/v1/matches/match-A/visibility", map[string]any{"hidden": true}},
		{"delete annotation", http.MethodDelete, "/api/v1/matches/match-A/annotation", nil},
		{"reset match data", http.MethodDelete, "/api/v1/matches/match-A/data", nil},
		{"clear review", http.MethodDelete, "/api/v1/matches/match-A/review", nil},
		{"clear queue", http.MethodDelete, "/api/v1/matches/match-A/queue", nil},
		{"clear play mode", http.MethodDelete, "/api/v1/matches/match-A/play-mode", nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			mux := newClosedStoreMux(t)
			rec := fire(t, mux, tc.method, tc.path, tc.body)
			p := assertProblem(t, rec, http.StatusInternalServerError, "internal", "")
			if p.Detail == "" {
				t.Error("500 problem carries no detail; the store error is lost")
			}
		})
	}
}

// The read side has the same rule: a load failure must not decode as a
// 200 with a null/empty body, which the Matches view would render as
// "no matches yet" — indistinguishable from an empty corpus.
func TestStoreFailure_ReadsReportInternalProblemNotEmptyResults(t *testing.T) {
	for _, path := range []string{
		"/api/v1/matches",
		"/api/v1/matches/match-A",
		"/api/v1/database/health",
		"/api/v1/database",
	} {
		t.Run(path, func(t *testing.T) {
			mux := newClosedStoreMux(t)
			assertProblem(t, get(t, mux, path), http.StatusInternalServerError, "internal", "")
		})
	}
}

// The bundle export aggregates before it zips, so a load failure has to
// fail the download rather than hand the user a valid-looking .zip that
// silently omits every match.
func TestStoreFailure_ExportBundleFailsInsteadOfShippingAnEmptyZip(t *testing.T) {
	mux := newClosedStoreMux(t)
	rec := postRaw(t, mux, "/api/v1/exports/bundle", `{"match_keys":["match-A"]}`)
	assertProblem(t, rec, http.StatusInternalServerError, "internal", "")
	if cd := rec.Header().Get("Content-Disposition"); cd != "" {
		t.Errorf("failed export must not advertise a download; Content-Disposition=%q", cd)
	}
}
