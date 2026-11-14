package db

import "database/sql"

// UpsertIngestedFile records (or refreshes) a file's content hash in
// the dedup registry. first_seen_at survives re-parses the same way
// parsed_at does on the parent tables.
//
// The Null* binds here and the COALESCE on the read are the whole of the
// zero-vs-NULL boundary: callers say a zero FileRef for an original, the
// columns say NULL so the self-FK exempts it, and neither side has to know
// about the other.
func (s *SQLStore) UpsertIngestedFile(file FileRef, contentHash string, duplicateOf FileRef) error {
	var dupDir sql.NullInt64
	var dupName sql.NullString
	if duplicateOf.Filename != "" {
		dupDir = sql.NullInt64{Int64: dirIDOrSentinel(duplicateOf.DirID), Valid: true}
		dupName = sql.NullString{String: duplicateOf.Filename, Valid: true}
	}
	_, err := s.db.Exec(
		`INSERT INTO ingested_files (screenshots_dir_id, filename, content_hash, duplicate_of_dir_id, duplicate_of)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(screenshots_dir_id, filename) DO UPDATE SET
		   content_hash        = excluded.content_hash,
		   duplicate_of_dir_id = excluded.duplicate_of_dir_id,
		   duplicate_of        = excluded.duplicate_of`,
		dirIDOrSentinel(file.DirID), file.Filename, contentHash, dupDir, dupName,
	)
	return err
}

// LoadIngestedFiles returns the whole registry keyed by (folder, filename).
func (s *SQLStore) LoadIngestedFiles() (map[FileRef]IngestedFile, error) {
	rows, err := s.db.Query(
		`SELECT screenshots_dir_id, filename, content_hash,
		        COALESCE(duplicate_of_dir_id, 0), COALESCE(duplicate_of, ''), first_seen_at
		 FROM ingested_files`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := map[FileRef]IngestedFile{}
	for rows.Next() {
		var f FileRef
		var r IngestedFile
		if err := rows.Scan(&f.DirID, &f.Filename, &r.ContentHash,
			&r.DuplicateOf.DirID, &r.DuplicateOf.Filename, &r.FirstSeenAt); err != nil {
			return nil, err
		}
		out[f] = r
	}
	return out, rows.Err()
}
