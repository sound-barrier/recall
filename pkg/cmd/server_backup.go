package cmd

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"recall/pkg/app"
)

// registerBackupRoutes attaches the /api/v1/exports + /api/v1/imports
// handlers. Three routes: GET /exports (JSON or CSV-ZIP, `?format=`
// switches), POST /exports/bundle (compressed .zip with manifest +
// data + screenshots), POST /imports (REPLACE the local DB from a
// previously-exported payload).
func registerBackupRoutes(apiMux *http.ServeMux, a *app.App) {
	apiMux.HandleFunc("GET /api/v1/exports", handleExportData(a))
	apiMux.HandleFunc("POST /api/v1/exports/bundle", handleExportBundle(a))
	apiMux.HandleFunc("POST /api/v1/imports", handleImportData(a))
}

// handleExportData streams the full DB export. The `format` query selects
// the wire format. Default is JSON — CSV emits a ZIP archive (one CSV per
// parent/child table + manifest).
func handleExportData(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// `format` is OpenAPI-declared as enum:[json, csv] with default
		// json. Honor the spec literally: an absent param defaults to
		// json, anything outside the enum (including the empty string
		// from `?format=`) is 400. The previous "json, \"\"" combined
		// case treated `?format=` (explicit empty) as the same as
		// "param absent" and silently fell through to JSON — that's
		// the schema violation v4's negative_data_rejection caught.
		// Pinned by TestExports_RejectsEmptyFormat.
		query := r.URL.Query()
		format := "json"
		if query.Has("format") {
			format = query.Get("format")
		}
		switch format {
		case "csv":
			data, err := a.ExportDataCSV()
			if writeError(w, r, err) {
				return
			}
			fname := "recall-export-" + time.Now().UTC().Format("20060102-150405") + ".zip"
			w.Header().Set("Content-Type", "application/zip")
			w.Header().Set("Content-Disposition", `attachment; filename="`+fname+`"`)
			_, _ = w.Write(data)
		case "json":
			data, err := a.ExportData()
			if writeError(w, r, err) {
				return
			}
			fname := "recall-export-" + time.Now().UTC().Format("20060102-150405") + ".json"
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Content-Disposition", `attachment; filename="`+fname+`"`)
			_, _ = w.Write(data)
		default:
			writeProblem(w, r, probInvalidBody, "format must be 'json' or 'csv'")
		}
	}
}

// handleExportBundle assembles a compressed bundle export. Body declares
// the included match keys plus optional include-unknown / include-hidden
// toggles; response is the assembled `.zip` (manifest.json + data.json +
// screenshots/<filename>). See pkg/app/export_bundle.go.
func handleExportBundle(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// json.RawMessage on every field so a literal `null` (which
		// Go's default decoder silently treats as the zero value)
		// can be rejected as a schema violation — the spec declares
		// `match_keys` as `type: array` and the toggles as
		// `type: boolean`, neither nullable.
		var body struct {
			MatchKeys      json.RawMessage `json:"match_keys"`
			IncludeUnknown json.RawMessage `json:"include_unknown"`
			IncludeHidden  json.RawMessage `json:"include_hidden"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeProblem(w, r, probInvalidBody, "invalid JSON body")
			return
		}
		matchKeys, mkErr := decodeRequiredStringArray("match_keys", body.MatchKeys)
		if mkErr != nil {
			writeProblem(w, r, probInvalidBody, mkErr.Error())
			return
		}
		includeUnknown, ferr := decodeOptionalBool("include_unknown", body.IncludeUnknown)
		if ferr != nil {
			writeProblem(w, r, probInvalidBody, ferr.Error())
			return
		}
		includeHidden, ferr := decodeOptionalBool("include_hidden", body.IncludeHidden)
		if ferr != nil {
			writeProblem(w, r, probInvalidBody, ferr.Error())
			return
		}
		data, err := a.ExportBundle(app.ExportBundleOptions{
			MatchKeys:      matchKeys,
			IncludeUnknown: includeUnknown,
			IncludeHidden:  includeHidden,
		})
		if writeError(w, r, err) {
			return
		}
		fname := "recall-bundle-" + time.Now().UTC().Format("20060102-150405") + ".zip"
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", `attachment; filename="`+fname+`"`)
		_, _ = w.Write(data)
	}
}

// handleImportData POSTs a previously-exported payload to REPLACE the
// local DB. Accepts both the JSON envelope and the CSV ZIP archive — the
// app layer sniffs the payload's magic bytes.
func handleImportData(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Cap at 50 MiB — large but generous for years of OW history;
		// guards against an accidentally-uploaded multi-GB blob.
		body, err := io.ReadAll(io.LimitReader(r.Body, 50<<20))
		if err != nil {
			writeProblem(w, r, probInvalidBody, "read body: "+err.Error())
			return
		}
		if err := a.ImportData(body); err != nil {
			// Split sentinel: ErrImportMalformed → 400 (payload not
			// JSON/ZIP, decode failure, zip-open failure). Anything
			// else → 409 (semantic validation failure: unsupported
			// schema, missing required field, write failure).
			// Schemathesis's `positive_data_acceptance` check disallows
			// 400 for spec-valid inputs; the malformed branch only
			// fires on spec-violating payloads.
			if errors.Is(err, app.ErrImportMalformed) {
				writeProblem(w, r, probInvalidBody, err.Error())
				return
			}
			writeProblem(w, r, probConflict, err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
