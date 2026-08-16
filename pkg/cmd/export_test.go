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

// The error→status ladder itself. writeError is what every write handler
// funnels a failure through, so the sentinel-ladder test drives it directly
// rather than standing up a route per sentinel; defaultProblems is the
// route-INDEPENDENT half of the mapping, and the test asserts which sentinels
// belong to it (the rest get their status from a handler's own cases).
var (
	WriteError      = writeError
	DefaultProblems = defaultProblems
	ProblemStatus   = func(pt problemType) int { return pt.status }
	ProblemSlug     = func(pt problemType) string { return pt.slug }
)

// ErrStatusIs exposes the sentinel half of an errStatus rung so the ladder
// test can enumerate defaultProblems without importing the unexported type.
func ErrStatusIs(i int) error { return defaultProblems[i].is }

// ErrStatusProblem exposes the problem half of the same rung.
func ErrStatusProblem(i int) (slug string, status int) {
	pt := defaultProblems[i].pt
	return pt.slug, pt.status
}

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
