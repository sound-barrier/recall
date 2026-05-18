package cmd

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"recall/pkg/app"
)

// RunServer initialises the App without the Wails GUI and serves the
// embedded frontend + a JSON REST API on 127.0.0.1:7000.
func RunServer(a *app.App, assets embed.FS) {
	a.SSEHub = app.NewSSEHub()

	// Startup loads settings, initialises SQLite, optionally starts
	// the metrics server and file watcher.
	a.Startup(context.Background())

	mux := http.NewServeMux()

	// ── REST API ────────────────────────────────────────────────────
	mux.HandleFunc("/api/match-results", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		rows, err := a.GetMatchResults()
		writeJSON(w, rows, err)
	})

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
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			writeJSON(w, map[string]string{"path": body.Path}, nil)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/parse", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		err := a.ParseScreenshots()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]bool{"ok": true}, nil)
	})

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

	mux.HandleFunc("/api/tesseract-status", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		writeJSON(w, a.GetTesseractStatus(), nil)
	})

	mux.HandleFunc("/api/tesseract-path", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var body struct {
			Path string `json:"path"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Path == "" {
			http.Error(w, "body must be {\"path\":\"...\"}", http.StatusBadRequest)
			return
		}
		st, err := a.SetTesseractPath(body.Path)
		writeJSON(w, st, err)
	})

	mux.HandleFunc("/api/tesseract-reset", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		st, err := a.ResetTesseractPath()
		writeJSON(w, st, err)
	})

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
			case event := <-ch:
				_, _ = fmt.Fprintf(w, "event: %s\ndata: {}\n\n", event)
				flusher.Flush()
			case <-ticker.C:
				_, _ = fmt.Fprintf(w, ": keepalive\n\n")
				flusher.Flush()
			}
		}
	})

	// ── Screenshot image serving ────────────────────────────────────
	mux.Handle("/_screenshot/", a.ScreenshotHandler())

	// ── Static frontend assets ──────────────────────────────────────
	// Sub into frontend/dist so paths like "/assets/index.js" resolve correctly.
	sub, err := fs.Sub(assets, "frontend/dist")
	if err != nil {
		log.Fatalf("server: could not sub into embedded assets: %v", err)
	}
	mux.Handle("/", http.FileServer(http.FS(sub)))

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
