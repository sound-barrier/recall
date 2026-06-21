package parser

// Test-only bridges for the external parser_test package. The OCR/text
// primitives, the geometry detectors, and the two function-variable seams have
// no public string→string (or image→geometry) entry point — the public surface
// is ParseScreenshot, which needs Tesseract. Compiled only under test, so none
// of this widens the shipped API.
var (
	Digitize              = digitize
	Levenshtein           = levenshtein
	ExtractInts           = extractInts
	ExtractHeroes         = extractHeroes
	ExtractModifiers      = extractModifiers
	ExtractRank           = extractRank
	ExtractSR             = extractSR
	SRFromRun             = srFromRun
	NormalizeDate         = normalizeDate
	SnapToKnownMap        = snapToKnownMap
	BestKnownMapInText    = bestKnownMapInText
	ParseHeroesPlayed     = parseHeroesPlayed
	ParsePerformance      = parsePerformance
	ParsePersonalStatCell = parsePersonalStatCell
	ClassifyQueueByCount  = classifyQueueByCount
	CountDigitLines       = countDigitLines
	FindStatColumns       = findStatColumns
	FindHighlightedRowY   = findHighlightedRowY
	FindRowXExtent        = findRowXExtent
	Crop                  = crop
	IsSummaryScreenshot   = isSummaryScreenshot
	IsRankScreenshot      = isRankScreenshot
	IsPersonalScreenshot  = isPersonalScreenshot
	GetTesseractPath      = getTesseractPath
	KnownModifiers        = knownModifiers

	// Function-variable seams — pointers so tests can save/set/restore the
	// stub AND call through the current value.
	RunTesseractFunc = &runTesseractFunc
	ParseSingleFunc  = &parseSingleFunc
)

// HeroStatKeys exposes the loaded dataset's hero→stat-key map (an unexported
// field of the unexported owDataset) for the embedded-YAML coverage test.
func HeroStatKeys() map[string][]string { return loadDataset().heroStatKeys }
