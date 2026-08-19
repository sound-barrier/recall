package db

import "fmt"

// The SENT ledger — one row per "share with a coach" export, the receipt
// that a set of matches left for a named coach. Written by the app's share
// path and read by the Reviews tab's "Sent" strip; never part of match
// history (a share is a fact about a file, not about a match), so only
// Clear removes rows.

// ShareExport is one recorded share, match keys in selection order.
type ShareExport struct {
	ID         int64
	Handle     string
	Message    string
	ExportedAt string
	SavedPath  string
	MatchKeys  []string
}

// ShareExportStore is the sent ledger's surface.
type ShareExportStore interface {
	// RecordShareExport appends a row; keys keep their order. Returns the
	// stored row, stamp included.
	RecordShareExport(handle, message, savedPath string, matchKeys []string) (ShareExport, error)
	// ListShareExports returns every recorded share, newest first.
	ListShareExports() ([]ShareExport, error)
}

func (s *SQLStore) RecordShareExport(handle, message, savedPath string, matchKeys []string) (ShareExport, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return ShareExport{}, fmt.Errorf("record share export: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	res, err := tx.Exec(
		`INSERT INTO share_exports (handle, message, saved_path) VALUES (?, ?, ?)`,
		handle, message, savedPath,
	)
	if err != nil {
		return ShareExport{}, fmt.Errorf("insert share export: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return ShareExport{}, fmt.Errorf("share export id: %w", err)
	}
	for i, key := range matchKeys {
		if _, err := tx.Exec(
			`INSERT INTO share_export_matches (export_id, match_key, sort_order) VALUES (?, ?, ?)`,
			id, key, i,
		); err != nil {
			return ShareExport{}, fmt.Errorf("insert share export match: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return ShareExport{}, fmt.Errorf("commit share export: %w", err)
	}
	return s.loadShareExport(id)
}

func (s *SQLStore) loadShareExport(id int64) (ShareExport, error) {
	row := s.db.QueryRow(
		`SELECT id, handle, message, exported_at, saved_path FROM share_exports WHERE id = ?`, id)
	var e ShareExport
	if err := row.Scan(&e.ID, &e.Handle, &e.Message, &e.ExportedAt, &e.SavedPath); err != nil {
		return ShareExport{}, fmt.Errorf("load share export: %w", err)
	}
	keys, err := s.shareExportKeys(id)
	if err != nil {
		return ShareExport{}, err
	}
	e.MatchKeys = keys
	return e, nil
}

func (s *SQLStore) shareExportKeys(id int64) ([]string, error) {
	rows, err := s.db.Query(
		`SELECT match_key FROM share_export_matches WHERE export_id = ? ORDER BY sort_order`, id)
	if err != nil {
		return nil, fmt.Errorf("share export keys: %w", err)
	}
	defer func() { _ = rows.Close() }()
	keys := []string{}
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			return nil, fmt.Errorf("scan share export key: %w", err)
		}
		keys = append(keys, k)
	}
	return keys, rows.Err()
}

func (s *SQLStore) ListShareExports() ([]ShareExport, error) {
	rows, err := s.db.Query(
		`SELECT id, handle, message, exported_at, saved_path FROM share_exports ORDER BY id DESC`)
	if err != nil {
		return nil, fmt.Errorf("list share exports: %w", err)
	}
	defer func() { _ = rows.Close() }()
	out := []ShareExport{}
	for rows.Next() {
		var e ShareExport
		if err := rows.Scan(&e.ID, &e.Handle, &e.Message, &e.ExportedAt, &e.SavedPath); err != nil {
			return nil, fmt.Errorf("scan share export: %w", err)
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		keys, err := s.shareExportKeys(out[i].ID)
		if err != nil {
			return nil, err
		}
		out[i].MatchKeys = keys
	}
	return out, nil
}
