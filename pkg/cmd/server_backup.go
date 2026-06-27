package cmd

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"recall/pkg/app"
)

// registerBackupRoutes attaches the backup / restore / import handlers:
//   - GET  /api/v1/database        — download a native .db snapshot (backup)
//   - PUT  /api/v1/database        — replace the live DB from a .db snapshot
//   - POST /api/v1/exports/bundle  — selection-aware .zip (manifest+data+shots)
//   - POST /api/v1/imports         — MERGE a bundle's matches (additive)
func registerBackupRoutes(apiMux *http.ServeMux, a *app.App) {
	apiMux.HandleFunc("GET /api/v1/database", handleBackupDatabase(a))
	apiMux.HandleFunc("PUT /api/v1/database", handleRestoreDatabase(a))
	apiMux.HandleFunc("POST /api/v1/exports/bundle", handleExportBundle(a))
	apiMux.HandleFunc("POST /api/v1/imports", handleImportMatches(a))
}

// handleBackupDatabase streams a complete, compacted native SQLite snapshot of
// the database. Unlike the former JSON/CSV export it captures every table, so
// it is a true backup.
func handleBackupDatabase(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		data, err := a.BackupDatabase()
		if writeError(w, r, err) {
			return
		}
		fname := "recall-backup-" + time.Now().UTC().Format("20060102-150405") + ".db"
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Disposition", `attachment; filename="`+fname+`"`)
		_, _ = w.Write(data)
	}
}

// handleRestoreDatabase replaces the live database with an uploaded .db
// snapshot. A payload that isn't a usable Recall DB is 422; a parse mid-flight
// is 409; success is 204.
func handleRestoreDatabase(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(io.LimitReader(r.Body, importMaxBodyBytes))
		if err != nil {
			writeProblem(w, r, probInvalidBody, "read body: "+err.Error())
			return
		}
		if writeError(
			w, r, a.RestoreDatabase(body),
			errStatus{app.ErrRestoreInvalid, probRestoreInvalid},
			errStatus{app.ErrParseInFlight, probConflict},
		) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleImportMatches MERGES a previously-exported bundle's matches into the
// live DB. Additive: matches whose key already exists are skipped, nothing is
// wiped. Responds 200 with the {imported, skipped} counts.
func handleImportMatches(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(io.LimitReader(r.Body, importMaxBodyBytes))
		if err != nil {
			writeProblem(w, r, probInvalidBody, "read body: "+err.Error())
			return
		}
		summary, err := a.ImportMatches(body)
		// ErrImportMalformed → 400 (payload isn't a readable bundle);
		// anything else → 409 (unsupported schema, write failure).
		if errors.Is(err, app.ErrImportMalformed) {
			writeProblem(w, r, probInvalidBody, err.Error())
			return
		}
		if err != nil {
			writeProblem(w, r, probConflict, err.Error())
			return
		}
		writeJSON(w, r, summary, nil)
	}
}

// handleExportBundle assembles a compressed bundle export. Body declares the
// included match keys plus optional include-unknown / include-hidden toggles;
// response is the assembled `.zip` (manifest.json + data.json +
// screenshots/<filename>). See pkg/app/export_bundle.go.
func handleExportBundle(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// json.RawMessage on every field so a literal `null` (which Go's
		// default decoder silently treats as the zero value) can be rejected
		// as a schema violation — the spec declares `match_keys` as
		// `type: array` and the toggles as `type: boolean`, neither nullable.
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
