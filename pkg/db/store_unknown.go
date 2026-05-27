package db

import "database/sql"

// UpsertUnknown writes one unknown_screenshots row. No children — the
// unknown table exists only so parses aren't silently dropped on a
// detector miss; the matching parser.ScreenshotType decision happens
// at the App layer.
func (s *SQLStore) UpsertUnknown(r UnknownRow) error {
	_, err := s.db.Exec(
		`INSERT INTO unknown_screenshots (filename, match_key, screenshots_dir_id)
		VALUES (?,?,?)
		ON CONFLICT(filename) DO UPDATE SET
			match_key          = excluded.match_key,
			screenshots_dir_id = excluded.screenshots_dir_id`,
		r.Filename, r.MatchKey, nullableInt64(r.ScreenshotsDirID),
	)
	return err
}

func (s *SQLStore) loadUnknowns() ([]UnknownRow, error) {
	rows, err := s.db.Query(
		`SELECT id, filename, match_key, parsed_at, screenshots_dir_id
		FROM unknown_screenshots ORDER BY id`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]UnknownRow, 0)
	for rows.Next() {
		var r UnknownRow
		var dirID sql.NullInt64
		if err := rows.Scan(&r.ID, &r.Filename, &r.MatchKey, &r.ParsedAt, &dirID); err != nil {
			return nil, err
		}
		r.ScreenshotsDirID = dirID.Int64
		out = append(out, r)
	}
	return out, rows.Err()
}
