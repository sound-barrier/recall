package db

// UpsertIngestedFile records (or refreshes) a file's content hash in
// the dedup registry. first_seen_at survives re-parses the same way
// parsed_at does on the parent tables.
func (s *SQLStore) UpsertIngestedFile(filename, contentHash, duplicateOf string) error {
	_, err := s.db.Exec(
		`INSERT INTO ingested_files (filename, content_hash, duplicate_of)
		 VALUES (?,?,?)
		 ON CONFLICT(filename) DO UPDATE SET
		   content_hash = excluded.content_hash,
		   duplicate_of = excluded.duplicate_of`,
		filename, contentHash, duplicateOf,
	)
	return err
}

// LoadIngestedFiles returns the whole registry keyed by filename.
func (s *SQLStore) LoadIngestedFiles() (map[string]IngestedFile, error) {
	rows, err := s.db.Query(`SELECT filename, content_hash, duplicate_of FROM ingested_files`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]IngestedFile{}
	for rows.Next() {
		var f string
		var r IngestedFile
		if err := rows.Scan(&f, &r.ContentHash, &r.DuplicateOf); err != nil {
			return nil, err
		}
		out[f] = r
	}
	return out, rows.Err()
}
