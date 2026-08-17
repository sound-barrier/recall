package app

import "recall/pkg/matchedit"

// The per-match sidecar writers, the user-override layer, and manual
// match creation live in pkg/matchedit (carved out per the
// decomposition plan). These aliases keep pkg/cmd's sentinel mappings,
// the AnnotationInput request shape, the IgnoredScreenshot response
// shape, and every *App method signature byte-identical.
//
// Each Err* below MUST stay a plain alias. Re-declaring one with
// errors.New would break the handlers' errors.Is match and turn a 400
// into a silent 500; wrapping one with fmt.Errorf would keep the match
// but change the problem+json detail the API promises.

type (
	// AnnotationInput is the request shape for SetMatchAnnotation.
	AnnotationInput = matchedit.AnnotationInput
	// IgnoredScreenshot is one row of GetIgnoredScreenshots' response.
	IgnoredScreenshot = matchedit.IgnoredScreenshot
)

var (
	ErrInvalidLeaver     = matchedit.ErrInvalidLeaver
	ErrInvalidThrower    = matchedit.ErrInvalidThrower
	ErrEmptyAnnotation   = matchedit.ErrEmptyAnnotation
	ErrInvalidPlayMode   = matchedit.ErrInvalidPlayMode
	ErrInvalidQueueType  = matchedit.ErrInvalidQueueType
	ErrInvalidReviewedBy = matchedit.ErrInvalidReviewedBy

	// ErrIgnoreFilenameRequired maps "missing filename in URL" to a 400.
	ErrIgnoreFilenameRequired = matchedit.ErrIgnoreFilenameRequired

	// The user-override + manual-create sentinels. ErrMatchKeyRequired has
	// no consumer outside pkg/app; it is re-exported anyway so the whole
	// block stays one greppable unit.
	ErrMatchKeyRequired = matchedit.ErrMatchKeyRequired
	ErrInvalidResult    = matchedit.ErrInvalidResult
	ErrStatOutOfRange   = matchedit.ErrStatOutOfRange
	ErrUnknownMap       = matchedit.ErrUnknownMap
	ErrUnknownHero      = matchedit.ErrUnknownHero
	ErrManualNeedsMap   = matchedit.ErrManualNeedsMap
	ErrInvalidPlayedAt  = matchedit.ErrInvalidPlayedAt
	ErrInvalidRank      = matchedit.ErrInvalidRank
	ErrUnknownRank      = matchedit.ErrUnknownRank
	ErrMatchKeyExists   = matchedit.ErrMatchKeyExists
)
