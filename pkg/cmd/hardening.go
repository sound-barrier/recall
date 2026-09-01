package cmd

import (
	"net"
	"net/http"
	"os"
	"strings"
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
// The bundle-import (POST /imports) and native-restore (PUT /database)
// endpoints each cap their own read internally (io.LimitReader in
// server_backup.go); we give the middleware the same ceiling for those
// paths so the internal reader stays the thing that truncates a
// legitimately-large bundle or .db snapshot. Everything else gets a
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
	// importMaxBodyBytes matches the bundle-import / native-restore handlers'
	// own internal cap. A bundle carries screenshot bytes and a native .db
	// snapshot carries every table, so both can dwarf the old JSON export.
	importMaxBodyBytes int64 = 256 << 20 // 256 MiB
	// momentImageMaxBodyBytes caps one attachment. Deliberately far below the
	// import cap: this endpoint takes a picture, and anything the size of a
	// bundle arriving here is a mistake. app.maxMomentImageBytes holds the
	// same line for callers that never cross this boundary.
	momentImageMaxBodyBytes int64 = 8 << 20 // 8 MiB
)

// maxBodyForPath returns the body-size ceiling for a request path. The
// bundle-import (POST /imports), native-restore (PUT /database) and
// coaching-session (POST /coach/session) endpoints accept large binary
// uploads — the session opens the same kind of bundle /imports merges,
// screenshot bytes and all. Everything else is small JSON, the coaching
// note + summary writes included.
func maxBodyForPath(p string) int64 {
	switch p {
	case "/api/v1/imports", "/api/v1/database", "/api/v1/coach/session":
		return importMaxBodyBytes
	case "/api/v1/moment-images":
		// One screenshot, not an archive. 8 MiB is room for a large 1440p
		// capture and not room for a video; app.maxMomentImageBytes holds the
		// same line for callers that never cross this boundary.
		return momentImageMaxBodyBytes
	default:
		return defaultMaxBodyBytes
	}
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

// pprofTruthy is the accepted RECALL_PPROF opt-in vocabulary, matched
// case-insensitively. An allow-list rather than a deny-list because the
// variable mounts /debug/pprof on a server that runs without auth: a
// deny-list of "" / "0" / "false" turned every other spelling of NO —
// FALSE, no, off — into a silent yes, handing the user the exact opposite
// of what they typed. Unrecognized values fail closed.
var pprofTruthy = map[string]bool{
	"1": true, "t": true, "true": true,
	"y": true, "yes": true, "on": true,
}

// pprofEnabled reports whether the RECALL_PPROF opt-in is set to a
// truthy value. Used both to mount the pprof handlers (NewMux) and to
// warn when they're mounted on a non-loopback bind (RunServer), so the
// two stay in lockstep.
func pprofEnabled() bool {
	return pprofTruthy[strings.ToLower(strings.TrimSpace(os.Getenv("RECALL_PPROF")))]
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
