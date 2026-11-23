package parser

import (
	"image"

	"recall/pkg/glyphs"
	"recall/pkg/tesseract"
)

// Test-only bridges for the external parser_test package. The OCR/text
// primitives, the geometry detectors, and the two function-variable seams have
// no public string→string (or image→geometry) entry point — the public surface
// is ParseScreenshot, which needs Tesseract. SpecRect is the one reader of the
// region the OCR helpers stamp on a spec. Compiled only under test, so none
// of this widens the shipped API.
// OCRSpec re-exports the invocation-spec type so external stubs can
// declare the seam's signature; SpecName exposes the region identifier
// stubs key their canned output on.
type OCRSpec = ocrSpec

func SpecName(s OCRSpec) string { return s.name }

// SpecPSM exposes the page-segmentation mode so a stub can answer
// differently per attempt in ocrRowCells' PSM escalation ladder.
func SpecPSM(s OCRSpec) string { return s.psm }

// SpecWhitelist exposes the character whitelist, so a stub can answer a
// digits-only pass the way Tesseract would and any other pass differently.
func SpecWhitelist(s OCRSpec) string { return s.whitelist }

// SpecRect exposes the source-image region a stub was handed the crop of, so
// a test can check a recorded evidence rect against what OCR actually saw.
func SpecRect(s OCRSpec) image.Rectangle { return s.rect }

// UseGlyphReferences points the template cross-check at refs in place of the
// references embedded in the binary, so a test can draw its own glyphs; it
// returns the restore.
func UseGlyphReferences(refs *glyphs.References) (restore func()) {
	saved := readNumberFunc
	readNumberFunc = refs.ReadNumber
	return func() { readNumberFunc = saved }
}

// NewOCRSpec builds a spec from outside the package (fields are
// unexported) — used by the seam-swappability sanity test.
func NewOCRSpec(workDir, name, psm, whitelist string) OCRSpec {
	return OCRSpec{workDir: workDir, name: name, psm: psm, whitelist: whitelist}
}

var (
	RunTesseractWithRetry = runTesseractWithRetry
	ErrTesseractTimeout   = tesseract.ErrTimeout
	Digitize              = digitize
	Levenshtein           = levenshtein
	ExtractInts           = extractInts
	ExtractHeroes         = extractHeroes
	ExtractModifiers      = extractModifiers
	ExtractRank           = extractRank
	ExtractSR             = extractSR
	SRFromRun             = srFromRun
	NormalizeDate         = normalizeDate
	DetectResult          = detectResult
	SnapToKnownMap        = snapToKnownMap
	BestKnownMapInText    = bestKnownMapInText
	ParseHeroesPlayed     = parseHeroesPlayed
	ParsePersonalStatCell = parsePersonalStatCell
	ClassifyQueueByCount  = classifyQueueByCount
	CountDigitLines       = countDigitLines
	CandidateNameFromOCR  = candidateNameFromOCR
	DetectQueueType       = detectQueueType
	TeamBlockY            = teamBlockY
	IsBlueTablePixel      = isBlueTablePixel
	IsRedTablePixel       = isRedTablePixel
	ParseTeams            = parseTeams
	FindStatColumns       = findStatColumns
	FindHighlightedRowY   = findHighlightedRowY
	FindRowXExtent        = findRowXExtent
	IsSummaryScreenshot   = isSummaryScreenshot
	IsRankScreenshot      = isRankScreenshot
	IsPersonalScreenshot  = isPersonalScreenshot
	IsHistoryScreenshot   = isHistoryScreenshot
	ParseImage            = parseImage
	ParseRank             = parseRank
	ExtractRankPercentile = extractRankPercentile
	SignedPct             = signedPct
	UnknownChipTokens     = unknownChipTokens
	ParseSummary          = parseSummary
	ParsePersonal         = parsePersonal
	GetTesseractPath      = tesseract.Path

	// Function-variable seams — pointers so tests can save/set/restore the
	// stub AND call through the current value.
	RunTesseractFunc = &runTesseractFunc
	ParseSingleFunc  = &parseSingleFunc
)

// HeroStatKeys exposes the loaded dataset's hero→stat-key map (an unexported
// field of the unexported owDataset) for the embedded-YAML coverage test.
func HeroStatKeys() map[string][]string { return loadDataset().heroStatKeys }

// TesseractRetryDelays lets the retry test collapse the backoff.
var TesseractRetryDelays = &tesseractRetryDelays

// RunTesseractSeam exposes the exec seam for the retry test.
var RunTesseractSeam = &runTesseractFunc
