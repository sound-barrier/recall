package cmd

// Test-only aliases exposing the matches pagination/validation helpers to the
// external cmd_test package. The endpoint behavior is covered black-box via the
// /matches route; these direct unit tests pin the pure helpers' edge cases
// (cursor decoding, limit clamping, strict query validation). Compiled only
// under test, so they widen no real API.
var (
	ValidateMatchesQueryParams   = validateMatchesQueryParams
	ParseMatchesPaginationStrict = parseMatchesPaginationStrict
	ParseMatchesPagination       = parseMatchesPagination
	ApplyMatchesPagination       = applyMatchesPagination
)

// RFC 9457 problem writer + its §3.2 extension members. The
// `failed_assets` member has exactly one producer — the
// POST /api/v1/system/data-update handler — and reaching it needs a live
// download from the Pages data channel, so the wire shape has no
// hermetic HTTP seam. These re-exports let the external tests pin it
// directly.
var (
	WriteProblem     = writeProblem
	WithFailedAssets = withFailedAssets
	ProbDataVerify   = probDataVerify
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
