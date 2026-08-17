package bundle

// MaxZipEntryBytes points at the decompressed per-entry cap Read passes to
// ReadZipEntry for the bundle's own entries. Exposed as a pointer so the
// external bundle_test package can lower the cap and prove the wiring from
// Import down to the bomb rejection without inflating 64 MiB — the
// var-not-const test seam import_archive.go documents. Compiled only under
// test; widens no real API.
var MaxZipEntryBytes = &maxZipEntryBytes

// DropPreV3RankReadings + the schema constants, so the external test can pin
// the rule that a pre-v3 bundle's rank readings are not trustworthy.
var (
	DropPreV3RankReadings = dropPreV3RankReadings
	ExportSchemaV2        = exportSchemaV2
	ExportSchemaV3        = exportSchemaV3
)
