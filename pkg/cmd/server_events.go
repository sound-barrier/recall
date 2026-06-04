package cmd

import (
	"fmt"
	"net/http"
	"time"

	"recall/pkg/app"
)

// registerEventsRoutes attaches the /api/v1/events SSE handler.
// One route — the indefinite-duration server-sent event stream the
// frontend subscribes to for parse-complete + parse-progress
// notifications. Kept in its own file because the streaming /
// flusher / keepalive shape is structurally different from every
// other handler in the package + makes the file diffs cleaner when
// touched.
func registerEventsRoutes(apiMux *http.ServeMux, a *app.App) {
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
}
