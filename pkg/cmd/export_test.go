package cmd

// Test-only aliases exposing the matches pagination/validation helpers to the
// external cmd_test package. The endpoint behaviour is covered black-box via the
// /matches route; these direct unit tests pin the pure helpers' edge cases
// (cursor decoding, limit clamping, strict query validation). Compiled only
// under test, so they widen no real API.
var (
	ValidateMatchesQueryParams   = validateMatchesQueryParams
	ParseMatchesPaginationStrict = parseMatchesPaginationStrict
	ParseMatchesPagination       = parseMatchesPagination
	ApplyMatchesPagination       = applyMatchesPagination
)

// Middleware + hardening internals. The request-id / security-hardening
// middleware wrap a caller-supplied handler (NewMux can't inject one), and the
// body-cap / loopback / pprof predicates are pure helpers with no public seam.
var (
	WithRequestID         = withRequestID
	WithSecurityHardening = withSecurityHardening
	MaxBodyForPath        = maxBodyForPath
	IsLoopbackBind        = isLoopbackBind
	PprofEnabled          = pprofEnabled
	DefaultMaxBodyBytes   = defaultMaxBodyBytes
	ImportMaxBodyBytes    = importMaxBodyBytes
)
