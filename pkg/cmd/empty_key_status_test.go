package cmd_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"recall/pkg/app"
	"recall/pkg/cmd"
)

// An empty match key is a malformed request. Before this mapping existed the
// sentinel fell through writeError's ladder to 500, so a desktop caller that
// passed no key was told the server had broken.
func TestWriteError_EmptyMatchKeyIsABadRequest(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPut, "/api/v1/probe", nil)
	cmd.WriteError(rec, req, app.ErrMatchKeyRequired)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 — an unmapped sentinel reads as a server fault", rec.Code)
	}
}
