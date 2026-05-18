package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"
)

// sseHub manages a set of Server-Sent Events subscribers. Each connected
// browser tab gets its own buffered channel; broadcast delivers to all of
// them without blocking.
type sseHub struct {
	mu      sync.Mutex
	clients map[chan string]struct{}
}

func newSSEHub() *sseHub {
	return &sseHub{clients: make(map[chan string]struct{})}
}

func (h *sseHub) subscribe() chan string {
	ch := make(chan string, 8)
	h.mu.Lock()
	h.clients[ch] = struct{}{}
	h.mu.Unlock()
	return ch
}

func (h *sseHub) unsubscribe(ch chan string) {
	h.mu.Lock()
	delete(h.clients, ch)
	h.mu.Unlock()
	close(ch)
}

func (h *sseHub) broadcast(event string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.clients {
		select {
		case ch <- event:
		default: // drop if the client isn't reading fast enough
		}
	}
}

// runServer initialises the App without the Wails GUI and serves the
// embedded frontend + a JSON REST API on 127.0.0.1:7000.
func runServer(app *App) {
	app.sseHub = newSSEHub()

	// startup() loads settings, initialises SQLite, optionally starts
	// the metrics server and file watcher. The context.Background()
	// placeholder means a.ctx is set but wruntime.EventsEmit is guarded
	// by the `a.ctx != nil` check that already exists in app.go.
	app.startup(context.Background())

	mux := http.NewServeMux()

	// ── REST API ────────────────────────────────────────────────────
	mux.HandleFunc("/api/match-results", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		rows, err := app.GetMatchResults()
		writeJSON(w, rows, err)
	})

	mux.HandleFunc("/api/screenshots-dir", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			writeJSON(w, map[string]string{"path": app.GetScreenshotsDir()}, nil)
		case http.MethodPost:
			var body struct {
				Path string `json:"path"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Path == "" {
				http.Error(w, "body must be {\"path\":\"...\"}", http.StatusBadRequest)
				return
			}
			app.settings.ScreenshotsDir = body.Path
			if err := saveSettings(app.settings); err != nil {
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
		err := app.ParseScreenshots()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]bool{"ok": true}, nil)
	})

	mux.HandleFunc("/api/prometheus-enabled", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			writeJSON(w, map[string]bool{"enabled": app.GetPrometheusEnabled()}, nil)
		case http.MethodPost:
			var body struct {
				Enabled bool `json:"enabled"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				http.Error(w, "body must be {\"enabled\":bool}", http.StatusBadRequest)
				return
			}
			if err := app.SetPrometheusEnabled(body.Enabled); err != nil {
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
			writeJSON(w, map[string]bool{"enabled": app.GetWatchEnabled()}, nil)
		case http.MethodPost:
			var body struct {
				Enabled bool `json:"enabled"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				http.Error(w, "body must be {\"enabled\":bool}", http.StatusBadRequest)
				return
			}
			if err := app.SetWatchEnabled(body.Enabled); err != nil {
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
		writeJSON(w, app.GetTesseractStatus(), nil)
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
		st, err := app.SetTesseractPath(body.Path)
		writeJSON(w, st, err)
	})

	mux.HandleFunc("/api/tesseract-reset", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		st, err := app.ResetTesseractPath()
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

		ch := app.sseHub.subscribe()
		defer app.sseHub.unsubscribe(ch)

		// Send a keepalive comment every 25 s so proxies don't close the connection.
		ticker := time.NewTicker(25 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-r.Context().Done():
				return
			case event := <-ch:
				fmt.Fprintf(w, "event: %s\ndata: {}\n\n", event)
				flusher.Flush()
			case <-ticker.C:
				fmt.Fprintf(w, ": keepalive\n\n")
				flusher.Flush()
			}
		}
	})

	// ── Screenshot image serving ────────────────────────────────────
	// Reuse the existing handler which validates paths and streams from
	// the configured screenshots directory.
	mux.Handle("/_screenshot/", app.ScreenshotHandler())

	// ── Static frontend assets ──────────────────────────────────────
	// Serve the embedded frontend/dist just like Wails does. Sub into
	// the "frontend/dist" sub-tree so paths like "/assets/index.js"
	// resolve correctly.
	sub, err := fs.Sub(assets, "frontend/dist")
	if err != nil {
		log.Fatalf("server: could not sub into embedded assets: %v", err)
	}
	mux.Handle("/", http.FileServer(http.FS(sub)))

	srv := &http.Server{
		Addr:    "127.0.0.1:7000",
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

	log.Printf("Recall server listening on http://127.0.0.1:7000")
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
