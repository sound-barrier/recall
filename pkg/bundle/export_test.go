package bundle

// MaxZipEntryBytes points at the decompressed per-entry cap Read passes to
// ReadZipEntry for the bundle's own entries. Exposed as a pointer so the
// external bundle_test package can lower the cap and prove the wiring from
// Import down to the bomb rejection without inflating 64 MiB — the
// var-not-const test seam import_archive.go documents. Compiled only under
// test; widens no real API.
var MaxZipEntryBytes = &maxZipEntryBytes

// The data.json schema string, so the external test can spell it without
// re-deriving it. There is exactly one, by policy — see export_bundle.go.
var ExportSchema = exportSchema
