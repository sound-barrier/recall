package cmd

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"net/http/pprof"
	"os"
	"os/signal"
	"syscall"
	"time"

	"recall/pkg/app"
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

	log.Printf("Recall server listening on http://%s", addr)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server: %v", err)
	}
}

// methodGuard wraps h so only requests with the given method reach it;
// anything else is rejected with 405. Replaces the four-line preamble
// that single-method handlers used to carry by hand.
func methodGuard(method string, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != method {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		h(w, r)
	}
}

// NewMux builds the HTTP handler tree the server-mode binary serves.
// Split out of RunServer so tests can drive every route through
// httptest.NewServer without setting up signal handling or binding a
// real port. assets is the SPA root (e.g. an fs.Sub into the embedded
// frontend/dist); pass an fstest.MapFS in tests.
func NewMux(a *app.App, assets fs.FS) *http.ServeMux {
	mux := http.NewServeMux()

	// ── REST API ────────────────────────────────────────────────────
	mux.HandleFunc("/api/match-results", methodGuard(http.MethodGet, func(w http.ResponseWriter, r *http.Request) {
		rows, err := a.GetMatchResults()
		writeJSON(w, rows, err)
	}))

	mux.HandleFunc("/api/screenshots-dir", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			writeJSON(w, map[string]string{"path": a.GetScreenshotsDir()}, nil)
		case http.MethodPost:
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
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/parse", methodGuard(http.MethodPost, func(w http.ResponseWriter, r *http.Request) {
		err := a.ParseScreenshots()
		if err != nil {
			if errors.Is(err, app.ErrInvalidScreenshotsDir) {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]bool{"ok": true}, nil)
	}))

	mux.HandleFunc("/api/prometheus-enabled", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			writeJSON(w, map[string]bool{"enabled": a.GetPrometheusEnabled()}, nil)
		case http.MethodPost:
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
			writeJSON(w, map[string]bool{"enabled": body.Enabled}, nil)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/watch-enabled", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			writeJSON(w, map[string]bool{"enabled": a.GetWatchEnabled()}, nil)
		case http.MethodPost:
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
			writeJSON(w, map[string]bool{"enabled": body.Enabled}, nil)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/tesseract-status", methodGuard(http.MethodGet, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, a.GetTesseractStatus(), nil)
	}))

	mux.HandleFunc("/api/tesseract-path", methodGuard(http.MethodPost, func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Path string `json:"path"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Path == "" {
			http.Error(w, "body must be {\"path\":\"...\"}", http.StatusBadRequest)
			return
		}
		st, err := a.SetTesseractPath(body.Path)
		if err != nil {
			// A shape-validation failure is a 4xx (bad client input),
			// not a 5xx — mirrors how the screenshots-dir handler maps
			// ErrInvalidScreenshotsDir.
			if errors.Is(err, app.ErrInvalidTesseractPath) {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, st, nil)
	}))

	mux.HandleFunc("/api/tesseract-reset", methodGuard(http.MethodPost, func(w http.ResponseWriter, r *http.Request) {
		st, err := a.ResetTesseractPath()
		writeJSON(w, st, err)
	}))

	mux.HandleFunc("/api/check-update", methodGuard(http.MethodGet, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, a.CheckForUpdate(), nil)
	}))

	mux.HandleFunc("/api/version", methodGuard(http.MethodGet, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]string{"version": a.GetVersion()}, nil)
	}))

	mux.HandleFunc("/api/new-screenshot-count", methodGuard(http.MethodGet, func(w http.ResponseWriter, r *http.Request) {
		count, err := a.GetNewScreenshotCount()
		writeJSON(w, map[string]int{"count": count}, err)
	}))

	mux.HandleFunc("/api/clear-database", methodGuard(http.MethodPost, func(w http.ResponseWriter, r *http.Request) {
		if err := a.ClearDatabase(); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]bool{"ok": true}, nil)
	}))

	// ── Server-Sent Events ──────────────────────────────────────────
	mux.HandleFunc("/api/events", func(w http.ResponseWriter, r *http.Request) {
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

	// ── Screenshot image serving ────────────────────────────────────
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
