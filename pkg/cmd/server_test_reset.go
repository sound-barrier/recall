package cmd

import (
	"net/http"
	"os"

	"recall/pkg/app"
)

// registerE2ERoutes mounts test-harness-only routes, and ONLY when
// RECALL_E2E=1. That env var is set solely by the Playwright e2e harness
// (frontend/playwright.config.ts) — never by a released serveronly binary or
// the schemathesis api-drift run — so in production these routes are not
// registered (a request 404s) and they are deliberately absent from
// api/openapi.yaml. The reset itself is no more destructive than the public
// DELETE /api/v1/matches; the gate just keeps a profiles-wide reset out of the
// shipped surface.
func registerE2ERoutes(apiMux *http.ServeMux, a *app.App) {
	if os.Getenv("RECALL_E2E") != "1" {
		return
	}
	// Wipe the install back to a single empty "main" profile — the clean slate
	// the real-server e2e specs reset to in beforeEach/afterAll.
	apiMux.HandleFunc("POST /api/v1/system/test-reset", func(w http.ResponseWriter, _ *http.Request) {
		if writeError(w, a.ResetForTest()) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
