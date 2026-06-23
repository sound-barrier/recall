package cmd_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"recall/pkg/cmd"
)

func TestRequestID_MintsWhenAbsent(t *testing.T) {
	var seen string
	h := cmd.WithRequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = cmd.FromContext(r.Context())
	}))
	rec := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/matches", nil)
	h.ServeHTTP(rec, req)

	if seen == "" {
		t.Error("handler context had no request ID")
	}
	if got := rec.Header().Get("X-Request-ID"); got != seen {
		t.Errorf("response header X-Request-ID = %q, ctx had %q", got, seen)
	}
	if len(seen) != 16 {
		t.Errorf("minted ID length = %d, want 16 hex chars", len(seen))
	}
}

func TestRequestID_EchoesSafeClientID(t *testing.T) {
	var seen string
	h := cmd.WithRequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = cmd.FromContext(r.Context())
	}))
	rec := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/matches", nil)
	req.Header.Set("X-Request-ID", "user-supplied-42")
	h.ServeHTTP(rec, req)

	if seen != "user-supplied-42" {
		t.Errorf("ctx = %q, want client-supplied 'user-supplied-42'", seen)
	}
}

func TestRequestID_RejectsUnsafeClientID(t *testing.T) {
	for _, bad := range []string{
		"contains space",
		"newline\ninjected",
		strings.Repeat("x", 65),
	} {
		t.Run(bad, func(t *testing.T) {
			var seen string
			h := cmd.WithRequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				seen = cmd.FromContext(r.Context())
			}))
			rec := httptest.NewRecorder()
			req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/x", nil)
			req.Header.Set("X-Request-ID", bad)
			h.ServeHTTP(rec, req)

			if seen == bad {
				t.Error("unsafe client value was echoed into context")
			}
			if seen == "" {
				t.Error("middleware dropped client ID but didn't mint a replacement")
			}
		})
	}
}

func TestRequestID_FromContext_EmptyForBareContext(t *testing.T) {
	if got := cmd.FromContext(context.Background()); got != "" {
		t.Errorf("FromContext(background) = %q, want empty", got)
	}
}
