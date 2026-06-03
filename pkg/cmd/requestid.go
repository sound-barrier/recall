package cmd

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
)

// Request-ID middleware. Every API request gets a short hex ID,
// injected into the response's `X-Request-ID` header AND into the
// request context so handlers can include it in log lines. A
// client-supplied `X-Request-ID` is honored when present + safe;
// otherwise we mint one.
//
// Multi-step ingest flows (POST /parses → parser dispatch → DB
// upserts → SSE notify) can now be grepped out of a log file by
// a single ID. The header also lets a user reporting a bug paste
// the ID into the report.

type ctxKey int

const requestIDKey ctxKey = iota + 1

// FromContext returns the request ID associated with the context,
// or "" if none was set (e.g. background callers + tests that
// don't go through the middleware).
func FromContext(ctx context.Context) string {
	if v, ok := ctx.Value(requestIDKey).(string); ok {
		return v
	}
	return ""
}

func withRequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := sanitiseClientRequestID(r.Header.Get("X-Request-ID"))
		if id == "" {
			id = newRequestID()
		}
		w.Header().Set("X-Request-ID", id)
		ctx := context.WithValue(r.Context(), requestIDKey, id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// newRequestID returns a 16-hex-char (64-bit) random ID. Random
// is cheap here — we just need uniqueness across concurrent
// requests, not unforgeable secrecy.
func newRequestID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		// crypto/rand failure is essentially impossible in practice;
		// degrade gracefully so a missing /dev/urandom doesn't kill
		// the server.
		return "norand"
	}
	return hex.EncodeToString(b)
}

// sanitiseClientRequestID accepts a client-supplied header value
// when it's safe: ASCII printable, ≤ 64 chars, no whitespace. We
// drop anything weirder rather than echo it back into our own log
// lines (header-injection prevention).
func sanitiseClientRequestID(s string) string {
	if s == "" || len(s) > 64 {
		return ""
	}
	for _, r := range s {
		if r < '!' || r > '~' {
			return ""
		}
	}
	return s
}
