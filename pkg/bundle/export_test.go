package bundle

// MaxZipEntryBytes points at the decompressed per-entry cap readZipFile
// enforces. Exposed as a pointer so the external bundle_test package can lower
// the cap and drive both the zip-bomb rejection and the accept-at-exactly-the-
// cap boundary without inflating 64 MiB — the var-not-const test seam
// import_archive.go documents. Compiled only under test; widens no real API.
var MaxZipEntryBytes = &maxZipEntryBytes
