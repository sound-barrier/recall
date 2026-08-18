package coach

// MaxNotesEntryBytes exposes the decompressed notes.json cap so the external
// coach_test package can build an entry one byte over it instead of
// restating the number. Compiled only under test; widens no real API.
const MaxNotesEntryBytes = maxNotesEntryBytes

// NotesSchemaFor exposes the exporter's schema-selection rule so the external
// test package can assert the file's label matches its contents without
// restating the rule. Compiled only under test; widens no real API.
var NotesSchemaFor = notesSchemaFor
