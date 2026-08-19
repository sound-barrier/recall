package cmd

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"recall/pkg/app"
	"recall/pkg/bundle"
)

// registerBackupRoutes attaches the backup / restore / import /
// database-health handlers:
//   - GET  /api/v1/database             — download a native .db snapshot (backup)
//   - PUT  /api/v1/database             — replace the live DB from a .db snapshot
//   - GET  /api/v1/database/health      — integrity check + size/freelist stats
//   - POST /api/v1/database/maintenance — run optimize / vacuum, return fresh health
//   - POST /api/v1/exports/bundle       — selection-aware .zip (manifest+data+shots)
//   - POST /api/v1/exports/diagnostic   — parser-triage .zip (failed shots+logs+env)
//   - POST /api/v1/imports              — MERGE a bundle's matches (additive)
func registerBackupRoutes(apiMux *http.ServeMux, a *app.App) {
	apiMux.HandleFunc("GET /api/v1/database", handleBackupDatabase(a))
	apiMux.HandleFunc("PUT /api/v1/database", handleRestoreDatabase(a))
	apiMux.HandleFunc("GET /api/v1/database/health", handleDatabaseHealth(a))
	apiMux.HandleFunc("POST /api/v1/database/maintenance", handleDatabaseMaintenance(a))
	apiMux.HandleFunc("POST /api/v1/exports/bundle", handleExportBundle(a))
	apiMux.HandleFunc("GET /api/v1/shares", handleListShareExports(a))
	apiMux.HandleFunc("POST /api/v1/exports/diagnostic", handleExportDiagnostic(a))
	apiMux.HandleFunc("POST /api/v1/imports", handleImportMatches(a))
}

// handleDatabaseHealth reports the read-only health snapshot —
// integrity_check + page/freelist counts + file sizes.
func handleDatabaseHealth(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		health, err := a.GetDatabaseHealth()
		writeJSON(w, r, health, err)
	}
}

// handleDatabaseMaintenance runs one maintenance operation
// ("optimize" | "vacuum") and returns the refreshed health report.
// Unknown operation → 400; parse mid-flight → 409 (vacuum takes an
// exclusive lock, so maintenance serializes against the OCR loop).
func handleDatabaseMaintenance(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Operation string `json:"operation"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeProblem(w, r, probInvalidBody, "invalid JSON body")
			return
		}
		health, err := a.RunDatabaseMaintenance(body.Operation)
		if writeError(
			w, r, err,
			errStatus{app.ErrInvalidMaintenanceOp, probInvalidBody},
			errStatus{app.ErrParseInFlight, probConflict},
		) {
			return
		}
		writeJSON(w, r, health, nil)
	}
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
			errStatus{app.ErrProfileImmutable, probConflict},
		) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleImportMatches ingests either archive a user can hand Recall, told
// apart by ZIP entry names before any JSON is parsed. A bundle MERGES into
// the live DB — additive, matches whose key already exists are skipped,
// nothing is wiped; a coach notes archive is STAGED as a return sheet and
// changes no match until the player accepts a note. Responds 200 with the
// ImportOutcome, whose `kind` says which happened.
func handleImportMatches(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(io.LimitReader(r.Body, importMaxBodyBytes))
		if err != nil {
			writeProblem(w, r, probInvalidBody, "read body: "+err.Error())
			return
		}
		outcome, err := a.ImportMatches(body)
		if writeArchiveError(w, r, err) {
			return
		}
		writeJSON(w, r, outcome, nil)
	}
}

// handleExportBundle assembles a compressed bundle export. Body declares the
// included match keys, optional include-unknown / include-hidden toggles, and
// an optional `share` block naming the player when the export is meant for a
// coach; response is the assembled `.zip` (manifest.json + data.json +
// screenshots/<filename>). See pkg/app/bundle_alias.go.
func handleExportBundle(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		req, err := decodeExportBundleBody(r)
		if err != nil {
			writeProblem(w, r, probInvalidBody, err.Error())
			return
		}
		data, err := exportBundlePayload(a, req)
		if writeError(w, r, err,
			errStatus{bundle.ErrPlayerIdentityInvalid, probInvalidBody},
			errStatus{app.ErrNoPlayerHandle, probConflict}) {
			return
		}
		fname := "recall-bundle-" + time.Now().UTC().Format("20060102-150405") + ".zip"
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", `attachment; filename="`+fname+`"`)
		_, _ = w.Write(data)
	}
}

// exportBundleRequest is one decoded POST /api/v1/exports/bundle body: the
// selection, plus who the bundle is about when it is being shared with a
// coach (nil for the ordinary export).
type exportBundleRequest struct {
	opts  app.ExportBundleOptions
	share *app.SharePlayer
}

// decodeExportBundleBody validates the request body field by field. Every
// field decodes from json.RawMessage so a literal `null` (which Go's default
// decoder silently treats as the zero value) is rejected as the schema
// violation it is — the spec declares `match_keys` as `type: array`, the
// toggles as `type: boolean`, and `share` as `type: object`, none nullable.
func decodeExportBundleBody(r *http.Request) (exportBundleRequest, error) {
	var body struct {
		MatchKeys      json.RawMessage `json:"match_keys"`
		IncludeUnknown json.RawMessage `json:"include_unknown"`
		IncludeHidden  json.RawMessage `json:"include_hidden"`
		Share          json.RawMessage `json:"share"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return exportBundleRequest{}, errors.New("invalid JSON body")
	}
	matchKeys, err := decodeRequiredStringArray("match_keys", body.MatchKeys)
	if err != nil {
		return exportBundleRequest{}, err
	}
	includeUnknown, err := decodeOptionalBool("include_unknown", body.IncludeUnknown)
	if err != nil {
		return exportBundleRequest{}, err
	}
	includeHidden, err := decodeOptionalBool("include_hidden", body.IncludeHidden)
	if err != nil {
		return exportBundleRequest{}, err
	}
	share, err := decodeOptionalShare("share", body.Share)
	if err != nil {
		return exportBundleRequest{}, err
	}
	return exportBundleRequest{
		opts: app.ExportBundleOptions{
			MatchKeys:      matchKeys,
			IncludeUnknown: includeUnknown,
			IncludeHidden:  includeHidden,
		},
		share: share,
	}, nil
}

// decodeOptionalShare reads the `share` block. Absent means the ordinary
// export; an explicit null is a schema violation, the same rule
// decodeOptionalBool applies to the toggles. Only the handle and the message
// are read: the stable player id is minted and persisted server-side, so a
// request body can never claim to be somebody else.
func decodeOptionalShare(field string, raw json.RawMessage) (*app.SharePlayer, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return nil, nil
	}
	if bytes.Equal(trimmed, []byte("null")) {
		return nil, fmt.Errorf("%s must be an object, not null", field)
	}
	var share app.SharePlayer
	if err := json.Unmarshal(trimmed, &share); err != nil {
		return nil, fmt.Errorf("%s: %w", field, err)
	}
	return &share, nil
}

// exportBundlePayload picks the export mode the body asked for. The two are
// separate App methods on purpose: the plain export is incapable of stamping
// an identity, so a bundle can only name a player when the request said so.
func exportBundlePayload(a *app.App, req exportBundleRequest) ([]byte, error) {
	if req.share == nil {
		return a.ExportBundle(req.opts)
	}
	return a.ExportShareBundle(req.opts, *req.share)
}

// handleExportDiagnostic assembles the parser-triage zip (failed
// screenshots + logs + environment manifest). No request body; an empty
// failure ledger is a 409 — there's nothing to diagnose, and an empty
// zip would read as a broken export. See pkg/app/diagnostic.go.
func handleExportDiagnostic(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		data, err := a.ExportDiagnosticBundle()
		if writeError(w, r, err, errStatus{app.ErrNoFailedFiles, probConflict}) {
			return
		}
		fname := "recall-diagnostic-" + time.Now().UTC().Format("20060102-150405") + ".zip"
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", `attachment; filename="`+fname+`"`)
		_, _ = w.Write(data)
	}
}

// shareExportWire is db.ShareExport on the wire — snake_case, keys in
// selection order.
type shareExportWire struct {
	ID         int64    `json:"id"`
	Handle     string   `json:"handle"`
	Message    string   `json:"message"`
	ExportedAt string   `json:"exported_at"`
	SavedPath  string   `json:"saved_path,omitempty"`
	MatchKeys  []string `json:"match_keys"`
}

// handleListShareExports reads the sent ledger, newest first — the receipt
// strip on the Reviews tab.
func handleListShareExports(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sent, err := a.ListShareExports()
		if writeError(w, r, err) {
			return
		}
		wire := make([]shareExportWire, 0, len(sent))
		for _, e := range sent {
			wire = append(wire, shareExportWire{
				ID: e.ID, Handle: e.Handle, Message: e.Message,
				ExportedAt: e.ExportedAt, SavedPath: e.SavedPath, MatchKeys: e.MatchKeys,
			})
		}
		writeJSON(w, r, wire, nil)
	}
}
