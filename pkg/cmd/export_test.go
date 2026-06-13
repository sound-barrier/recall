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
