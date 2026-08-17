package parser

// Test-only bridges for the external parser_test package. The OCR/text
// primitives, the geometry detectors, and the two function-variable seams have
// no public string→string (or image→geometry) entry point — the public surface
// is ParseScreenshot, which needs Tesseract. Compiled only under test, so none
// of this widens the shipped API.
// OCRSpec re-exports the invocation-spec type so external stubs can
// declare the seam's signature; SpecName exposes the region identifier
// stubs key their canned output on.
type OCRSpec = ocrSpec

func SpecName(s OCRSpec) string { return s.name }

// SpecPSM exposes the page-segmentation mode so a stub can answer
// differently per attempt in ocrRowCells' PSM escalation ladder.
func SpecPSM(s OCRSpec) string { return s.psm }

// NewOCRSpec builds a spec from outside the package (fields are
// unexported) — used by the seam-swappability sanity test.
func NewOCRSpec(workDir, name, psm, whitelist string) OCRSpec {
	return OCRSpec{workDir: workDir, name: name, psm: psm, whitelist: whitelist}
}

var (
	RunTesseractWithRetry = runTesseractWithRetry
	ErrTesseractTimeout   = errTesseractTimeout
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
	ParsePerformance      = parsePerformance
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
	Crop                  = crop
	IsSummaryScreenshot   = isSummaryScreenshot
	IsRankScreenshot      = isRankScreenshot
	IsPersonalScreenshot  = isPersonalScreenshot
	ParseRank             = parseRank
	ExtractRankPercentile = extractRankPercentile
	UnknownChipTokens     = unknownChipTokens
	ParseSummary          = parseSummary
	ParsePersonal         = parsePersonal
	GetTesseractPath      = getTesseractPath

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
