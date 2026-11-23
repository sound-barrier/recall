package match

import "recall/pkg/parser"

// FieldFlag says one field's readings disagree with each other: the checks
// that noticed, and every reading they compared, so the reader can judge which
// one the pixels support. One flag per field, however many checks fired.
//
// Value is what the folded match holds for the field now, spelled as a
// reading is: the value stats use, and the one a confirmation is bound to.
type FieldFlag struct {
	Field    parser.FieldPath `json:"field"`
	Value    string           `json:"value"`
	Checks   []CheckID        `json:"checks"`
	State    FlagState        `json:"state"`
	Readings []FieldReading   `json:"readings"`
}

// FieldReading is one value a field was read or worked out as, and where it
// came from.
type FieldReading struct {
	SourceFile string        `json:"source_file"`
	Origin     ReadingOrigin `json:"origin"`
	Value      string        `json:"value"`
}

// CheckID names one cross-check. The API publishes the set as
// FieldCheckEnum.
type CheckID string

const (
	// CheckPerfTotalVsRate: a SUMMARY total against its own per-10-minute
	// rate over the minutes played.
	CheckPerfTotalVsRate CheckID = "perf_total_vs_rate"
	// CheckHeroPercentVsPlaytime: a hero's share of the match against its
	// share of the play time the same card lists.
	CheckHeroPercentVsPlaytime CheckID = "hero_percent_vs_playtime"
	// CheckResultVsRankMovement: the result against the rank screen's
	// movement and modifier pills.
	CheckResultVsRankMovement CheckID = "result_vs_rank_movement"
	// CheckSourceDisagreement: two screenshots of the same match read one
	// fact differently.
	CheckSourceDisagreement CheckID = "source_disagreement"
	// CheckPlausibleRange: a value no match can produce.
	CheckPlausibleRange CheckID = "plausible_range"
	// CheckTemplateDisagreement: the reference templates read the same
	// pixels as something else.
	CheckTemplateDisagreement CheckID = "template_disagreement"
)

// FlagState is where a flag stands with the user. The API publishes it as
// FieldFlagStateEnum.
type FlagState string

const (
	FlagOpen      FlagState = "open"      // nobody has looked at it yet
	FlagConfirmed FlagState = "confirmed" // the user said the reading is right
	FlagEdited    FlagState = "edited"    // the user corrected the field
)

// ReadingOrigin is how a reading was made. The API publishes it as
// FieldReadingOriginEnum.
type ReadingOrigin string

const (
	OriginOCR      ReadingOrigin = "ocr"      // Tesseract read it off the screenshot
	OriginTemplate ReadingOrigin = "template" // the reference templates read it
	OriginDerived  ReadingOrigin = "derived"  // worked out from other readings
)
