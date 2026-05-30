package cmd

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"net/http/pprof"
	"os"
	"os/signal"
	"syscall"
	"time"

	"recall/pkg/app"
	"recall/pkg/db"
)

// RunServer initializes the App without the Wails GUI and serves the
// embedded frontend + a JSON REST API on 127.0.0.1:7000.
func RunServer(a *app.App, assets embed.FS) {
	a.SSEHub = app.NewSSEHub()

	// Startup loads settings, initializes SQLite, optionally starts
	// the metrics server and file watcher.
	a.Startup(context.Background())

	// Sub into frontend/dist so paths like "/assets/index.js" resolve correctly.
	sub, err := fs.Sub(assets, "frontend/dist")
	if err != nil {
		log.Fatalf("server: could not sub into embedded assets: %v", err)
	}

	mux := NewMux(a, sub)

	addr := os.Getenv("RECALL_SERVER_ADDR")
	if addr == "" {
		addr = "127.0.0.1:7000"
	}

	srv := &http.Server{
		Addr:    addr,
		Handler: mux,
		// Slowloris mitigation (gosec G112): cap how long a client may
		// take to send the request headers. 10s is generous for any
		// real client; an attacker holding the socket open longer will
		// be cut off. Read/Write timeouts stay unset because /api/v1/events
		// is an indefinite-duration SSE stream.
		ReadHeaderTimeout: 10 * time.Second,
	}

	// Graceful shutdown on SIGINT / SIGTERM.
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-quit
		log.Println("server: shutting down…")
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
	}()

	// #nosec G706 -- addr is operator-controlled via RECALL_SERVER_ADDR
	// (or the compile-time default "127.0.0.1:7000"); never derived
	// from an inbound HTTP request, so no log-injection surface.
	log.Printf("Recall server listening on http://%s", addr)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server: %v", err)
	}
}

// NewMux builds the HTTP handler tree the server-mode binary serves.
// Split out of RunServer so tests can drive every route through
// httptest.NewServer without setting up signal handling or binding a
// real port. assets is the SPA root (e.g. an fs.Sub into the embedded
// frontend/dist); pass an fstest.MapFS in tests.
//
// Route conventions (since v0.1.x; was a flat /api/... layout before):
//   - Version prefix `/api/v1/` on every JSON endpoint.
//   - Resources are nouns; sub-resources hang off the parent (e.g.
//     /matches/{key}/visibility, /settings/tesseract).
//   - Methods reflect intent: GET to read, PUT to replace/upsert,
//     DELETE to clear or wipe, POST to kick off an async-ish action
//     that doesn't map to a single resource (the parse run).
//   - Returns 204 No Content for writes with no useful body, 202
//     Accepted for actions whose effect is asynchronous (parse).
//   - Static image binaries stay at /_screenshot/{filename} — they're
//     served from disk, not the JSON surface.
func NewMux(a *app.App, assets fs.FS) *http.ServeMux {
	mux := http.NewServeMux()

	// API routes live on a dedicated sub-mux so the `/` SPA fallback
	// doesn't swallow method-mismatched requests. With everything on
	// one mux, the no-method `/` pattern would always fully match a
	// request like `GET /api/v1/parses` (wrong method on a POST-only
	// route) and Go's ServeMux would route to the FileServer (404)
	// instead of returning 405. Isolating /api/v1/ in its own mux
	// preserves the REST-conventional 405 behavior because the sub-mux
	// has no catch-all.
	apiMux := http.NewServeMux()

	// ── Matches ─────────────────────────────────────────────────────
	apiMux.HandleFunc("GET /api/v1/matches", func(w http.ResponseWriter, r *http.Request) {
		rows, err := a.GetMatchResults()
		writeJSON(w, rows, err)
	})

	apiMux.HandleFunc("DELETE /api/v1/matches", func(w http.ResponseWriter, r *http.Request) {
		if err := a.ClearDatabase(); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	// Soft-delete (hide / unhide) a match. `hidden: true` adds the
	// match to hidden_matches; `hidden: false` removes it. Both are
	// idempotent — repeated identical calls succeed without error.
	apiMux.HandleFunc("PUT /api/v1/matches/{matchKey}/visibility", func(w http.ResponseWriter, r *http.Request) {
		matchKey := r.PathValue("matchKey")
		if matchKey == "" {
			http.Error(w, "match_key required in URL", http.StatusBadRequest)
			return
		}
		var body struct {
			Hidden bool `json:"hidden"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		var err error
		if body.Hidden {
			err = a.HideMatch(matchKey)
		} else {
			err = a.UnhideMatch(matchKey)
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	// Resolve an ambiguous-attribution screenshot by attaching every
	// parent row carrying the ambiguous: sentinel to the user's chosen
	// match. resolved_to must be one of the recorded candidates OR a
	// freshly-minted "match:<ts>" the user wants to attribute to a
	// new standalone match (escape hatch when none of the candidates
	// is right).
	apiMux.HandleFunc("PUT /api/v1/matches/{matchKey}/resolution", func(w http.ResponseWriter, r *http.Request) {
		matchKey := r.PathValue("matchKey")
		if matchKey == "" {
			http.Error(w, "match_key required in URL", http.StatusBadRequest)
			return
		}
		var body struct {
			ResolvedTo string `json:"resolved_to"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		if err := a.ResolveAmbiguousMatch(matchKey, body.ResolvedTo); err != nil {
			switch {
			case errors.Is(err, app.ErrInvalidAmbiguousKey),
				errors.Is(err, app.ErrInvalidResolution):
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			case errors.Is(err, db.ErrAmbiguousNotFound):
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	// Upsert (or clear) the per-match user annotation. When every
	// field is empty the row is deleted entirely — idempotent.
	apiMux.HandleFunc("PUT /api/v1/matches/{matchKey}/annotation", func(w http.ResponseWriter, r *http.Request) {
		matchKey := r.PathValue("matchKey")
		if matchKey == "" {
			http.Error(w, "match_key required in URL", http.StatusBadRequest)
			return
		}
		var body struct {
			Leaver     string   `json:"leaver"`
			Note       string   `json:"note"`
			ReplayCode string   `json:"replay_code"`
			Members    []string `json:"members"`
			Tags       []string `json:"tags"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		if err := a.SetMatchAnnotation(app.AnnotationInput{
			MatchKey:   matchKey,
			Leaver:     body.Leaver,
			Note:       body.Note,
			ReplayCode: body.ReplayCode,
			Members:    body.Members,
			Tags:       body.Tags,
		}); err != nil {
			if errors.Is(err, app.ErrInvalidLeaver) {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	// ── Parse pipeline ──────────────────────────────────────────────
	// Kicks off a synchronous parse run. Returns 202 Accepted because
	// the meaningful side-effect is the SQLite writes + SSE broadcast,
	// not the HTTP response body. Clients should subscribe to
	// /api/v1/events for progress and re-fetch /api/v1/matches when done.
	apiMux.HandleFunc("POST /api/v1/parses", func(w http.ResponseWriter, r *http.Request) {
		if err := a.ParseScreenshots(); err != nil {
			if errors.Is(err, app.ErrInvalidScreenshotsDir) {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusAccepted)
	})

	// ── Screenshots ─────────────────────────────────────────────────
	apiMux.HandleFunc("GET /api/v1/screenshots/pending-count", func(w http.ResponseWriter, r *http.Request) {
		count, err := a.GetNewScreenshotCount()
		writeJSON(w, map[string]int{"count": count}, err)
	})

	// ── Settings ────────────────────────────────────────────────────
	apiMux.HandleFunc("GET /api/v1/settings/screenshots-folder", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]string{"path": a.GetScreenshotsDir()}, nil)
	})
	apiMux.HandleFunc("PUT /api/v1/settings/screenshots-folder", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Path string `json:"path"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Path == "" {
			http.Error(w, "body must be {\"path\":\"...\"}", http.StatusBadRequest)
			return
		}
		if err := a.SetScreenshotsDir(body.Path); err != nil {
			if errors.Is(err, app.ErrInvalidScreenshotsDir) {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]string{"path": body.Path}, nil)
	})

	apiMux.HandleFunc("GET /api/v1/settings/tesseract", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, a.GetTesseractStatus(), nil)
	})
	apiMux.HandleFunc("PUT /api/v1/settings/tesseract", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Path string `json:"path"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Path == "" {
			http.Error(w, "body must be {\"path\":\"...\"}", http.StatusBadRequest)
			return
		}
		st, err := a.SetTesseractPath(body.Path)
		if err != nil {
			if errors.Is(err, app.ErrInvalidTesseractPath) {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, st, nil)
	})
	// DELETE resets the configured path back to the platform default —
	// the only "absent" state the field can have, modeled as removing
	// the user-set override.
	apiMux.HandleFunc("DELETE /api/v1/settings/tesseract", func(w http.ResponseWriter, r *http.Request) {
		st, err := a.ResetTesseractPath()
		writeJSON(w, st, err)
	})

	apiMux.HandleFunc("GET /api/v1/settings/prometheus", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]bool{"enabled": a.GetPrometheusEnabled()}, nil)
	})
	apiMux.HandleFunc("PUT /api/v1/settings/prometheus", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Enabled bool `json:"enabled"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "body must be {\"enabled\":bool}", http.StatusBadRequest)
			return
		}
		if err := a.SetPrometheusEnabled(body.Enabled); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	apiMux.HandleFunc("GET /api/v1/settings/watcher", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]bool{"enabled": a.GetWatchEnabled()}, nil)
	})
	apiMux.HandleFunc("PUT /api/v1/settings/watcher", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Enabled bool `json:"enabled"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "body must be {\"enabled\":bool}", http.StatusBadRequest)
			return
		}
		if err := a.SetWatchEnabled(body.Enabled); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	// ── System / Meta ───────────────────────────────────────────────
	apiMux.HandleFunc("GET /api/v1/system/version", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]string{"version": a.GetVersion()}, nil)
	})
	apiMux.HandleFunc("GET /api/v1/system/update", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, a.CheckForUpdate(), nil)
	})
	apiMux.HandleFunc("GET /api/v1/system/data-location", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, a.GetDataLocation(), nil)
	})
	apiMux.HandleFunc("GET /api/v1/system/reference-data", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, a.GetOWData(), nil)
	})
	apiMux.HandleFunc("GET /api/v1/system/screenshots-folder-probe", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, a.ProbeScreenshotsDir(), nil)
	})

	// ── Backup (exports) + Restore (imports) ────────────────────────
	// `format` query selects the wire format. Default is JSON — CSV
	// emits a ZIP archive (one CSV per parent/child table + manifest).
	apiMux.HandleFunc("GET /api/v1/exports", func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Query().Get("format") {
		case "csv":
			data, err := a.ExportDataCSV()
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			fname := "recall-export-" + time.Now().UTC().Format("20060102-150405") + ".zip"
			w.Header().Set("Content-Type", "application/zip")
			w.Header().Set("Content-Disposition", `attachment; filename="`+fname+`"`)
			_, _ = w.Write(data)
		case "json", "":
			data, err := a.ExportData()
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			fname := "recall-export-" + time.Now().UTC().Format("20060102-150405") + ".json"
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Content-Disposition", `attachment; filename="`+fname+`"`)
			_, _ = w.Write(data)
		default:
			http.Error(w, "format must be 'json' or 'csv'", http.StatusBadRequest)
		}
	})

	// POST a previously-exported payload to REPLACE the local DB.
	// Accepts both the JSON envelope and the CSV ZIP archive — the
	// app layer sniffs the payload's magic bytes.
	apiMux.HandleFunc("POST /api/v1/imports", func(w http.ResponseWriter, r *http.Request) {
		// Cap at 50 MiB — large but generous for years of OW history;
		// guards against an accidentally-uploaded multi-GB blob.
		body, err := io.ReadAll(io.LimitReader(r.Body, 50<<20))
		if err != nil {
			http.Error(w, "read body: "+err.Error(), http.StatusBadRequest)
			return
		}
		if err := a.ImportData(body); err != nil {
			// ImportData wraps validation + decode failures; the message
			// is descriptive enough to surface to the user.
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	// ── Server-Sent Events ──────────────────────────────────────────
	apiMux.HandleFunc("GET /api/v1/events", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no") // disable nginx buffering if proxied

		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming not supported", http.StatusInternalServerError)
			return
		}

		ch := a.SSEHub.Subscribe()
		defer a.SSEHub.Unsubscribe(ch)

		// Send a keepalive comment every 25 s so proxies don't close the connection.
		ticker := time.NewTicker(25 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-r.Context().Done():
				return
			case msg := <-ch:
				_, _ = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", msg.Event, msg.Data)
				flusher.Flush()
			case <-ticker.C:
				_, _ = fmt.Fprintf(w, ": keepalive\n\n")
				flusher.Flush()
			}
		}
	})

	// Mount the API sub-mux. Subtree pattern (`/api/v1/`) wins over
	// `/` for any request whose path starts with the prefix, so the
	// SPA fallback never sees these requests; method-mismatched calls
	// stay inside apiMux where they correctly return 405.
	mux.Handle("/api/v1/", apiMux)

	// ── Screenshot image serving ────────────────────────────────────
	// Stays at /_screenshot/{filename} — binary asset, not part of the
	// JSON API surface, so deliberately outside /api/v1/.
	mux.Handle("/_screenshot/", a.ScreenshotHandler())

	// ── pprof (opt-in via RECALL_PPROF) ──────────────────────────────
	// Off by default — only mounted when RECALL_PPROF is set to something
	// truthy. Wires the standard net/http/pprof handlers under
	// /debug/pprof/. Use with `go tool pprof http://127.0.0.1:7000/debug/pprof/heap`
	// (or profile, goroutine, allocs, …). Bind locally only — never expose
	// pprof on a public address.
	if v := os.Getenv("RECALL_PPROF"); v != "" && v != "0" && v != "false" {
		mux.HandleFunc("/debug/pprof/", pprof.Index)
		mux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
		mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
		mux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
		mux.HandleFunc("/debug/pprof/trace", pprof.Trace)
		log.Printf("server: pprof endpoints enabled at /debug/pprof/")
	}

	// ── Static frontend assets ──────────────────────────────────────
	mux.Handle("/", http.FileServer(http.FS(assets)))

	return mux
}

// writeJSON encodes v as JSON. If err is non-nil it writes a 500 instead.
func writeJSON(w http.ResponseWriter, v any, err error) {
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if encErr := json.NewEncoder(w).Encode(v); encErr != nil {
		log.Printf("server: json encode: %v", encErr)
	}
}
