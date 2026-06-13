package db

import "database/sql"

// RawDB exposes the store's internal handle to the external `db_test` package
// so black-box tests can assert on child-table state (cascade cleanup, server-
// stamped timestamps) that the exported Load/Save surface does not reveal. It is
// compiled only under test, so it is not part of the package's real API.
func RawDB(s *SQLStore) *sql.DB { return s.db }
