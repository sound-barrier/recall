package cmd

import (
	"net"
	"net/http"
	"os"
)

// Security hardening middleware: request-body size caps + a
// content-type-sniffing guard. Wraps the whole mux in RunServer
// (alongside withRequestID).
//
// Body caps (F1): every JSON handler decodes `r.Body` directly, and
// `json.Decoder` buffers a single complete value fully into memory —
// so a multi-GB but otherwise-valid JSON payload (e.g. a giant
// `match_keys` array on a bulk endpoint, or a huge string field on a
// setter) would OOM the process. Any host on the LAN can send one,
// and the server runs without auth by design. `http.MaxBytesReader`
// bounds the read so an oversize body fails fast with a decode error
// (surfaced as 400) instead of exhausting the heap.
//
// The import endpoint already caps its own read at 50 MiB internally
// (io.LimitReader in server_backup.go); we give the middleware the
// same ceiling for that path so the internal reader stays the thing
// that truncates a legitimately-large backup. Everything else gets a
// generous 8 MiB — comfortably larger than the biggest real payload
// (a select-all bulk match-key array is well under 1 MiB) while still
// bounding memory hard.
//
// nosniff (F6): defense-in-depth so a browser never sniffs a served
// screenshot or a JSON body into an executable content type. The
// screenshot handler already emits correct image/* types via
// http.ServeFile, so this is belt-and-suspenders, but it's free.

const (
	// defaultMaxBodyBytes caps non-import request bodies.
	defaultMaxBodyBytes int64 = 8 << 20 // 8 MiB
	// importMaxBodyBytes matches the import handler's own internal cap.
	importMaxBodyBytes int64 = 50 << 20 // 50 MiB
)

// maxBodyForPath returns the body-size ceiling for a request path.
// The import endpoint accepts a full DB backup; everything else is
// small JSON.
func maxBodyForPath(p string) int64 {
	if p == "/api/v1/imports" {
		return importMaxBodyBytes
	}
	return defaultMaxBodyBytes
}

func withSecurityHardening(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		// MaxBytesReader on a body-less request (GET, the SSE stream,
		// the screenshot handler) is harmless — the body is never
		// read, so the cap never trips. Guard nil for safety.
		if r.Body != nil {
			r.Body = http.MaxBytesReader(w, r.Body, maxBodyForPath(r.URL.Path))
		}
		next.ServeHTTP(w, r)
	})
}

// pprofEnabled reports whether the RECALL_PPROF opt-in is set to a
// truthy value. Used both to mount the pprof handlers (NewMux) and to
// warn when they're mounted on a non-loopback bind (RunServer), so the
// two stay in lockstep.
func pprofEnabled() bool {
	v := os.Getenv("RECALL_PPROF")
	return v != "" && v != "0" && v != "false"
}

// isLoopbackBind reports whether addr listens on a loopback-only
// interface. A bind with an empty or unspecified host (":7000",
// "0.0.0.0:7000", "[::]:7000") listens on every interface and returns
// false. (Mirror of metrics.isLoopbackBind — duplicated rather than
// shared to avoid a pkg/cmd → pkg/metrics dependency for one helper.)
func isLoopbackBind(addr string) bool {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return false // unparseable → treat as exposed
	}
	switch host {
	case "":
		return false
	case "localhost":
		return true
	default:
		ip := net.ParseIP(host)
		return ip != nil && ip.IsLoopback()
	}
}
