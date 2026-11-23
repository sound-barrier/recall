package db

import (
	"database/sql"
	"fmt"
	"image"

	"recall/pkg/parser"
)

// ScreenshotEvidence is what one parse recorded about where its readings came
// from: the image's pixel size and, per field, the region the value was read
// from with the templates' reading of it. The zero value is "nothing read".
type ScreenshotEvidence struct {
	ImageSize image.Point
	Fields    []parser.FieldEvidence
}

// ReplaceFieldEvidence makes ev the whole evidence record of one screenshot.
// Replaced rather than merged, because a re-parse is a new reading of the
// whole file: a field it no longer reads must not keep the region an earlier
// parse found. An empty ev forgets the screenshot's record.
func (s *SQLStore) ReplaceFieldEvidence(file FileRef, ev ScreenshotEvidence) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	dirID := dirIDOrSentinel(file.DirID)
	if _, err := tx.Exec(
		`DELETE FROM screenshot_images WHERE screenshots_dir_id = ? AND filename = ?`, dirID, file.Filename,
	); err != nil {
		return fmt.Errorf("replace field evidence: %w", err)
	}
	if ev.ImageSize == (image.Point{}) && len(ev.Fields) == 0 {
		return tx.Commit()
	}
	if err := insertFieldEvidence(tx, dirID, file.Filename, ev); err != nil {
		return fmt.Errorf("replace field evidence: %w", err)
	}
	return tx.Commit()
}

func insertFieldEvidence(tx txn, dirID int64, filename string, ev ScreenshotEvidence) error {
	if _, err := tx.Exec(
		`INSERT INTO screenshot_images (screenshots_dir_id, filename, width, height) VALUES (?, ?, ?, ?)`,
		dirID, filename, ev.ImageSize.X, ev.ImageSize.Y,
	); err != nil {
		return err
	}
	for _, f := range ev.Fields {
		var value sql.NullString
		var score, margin sql.NullFloat64
		if f.Template != nil {
			value = sql.NullString{String: f.Template.Value, Valid: true}
			score = sql.NullFloat64{Float64: f.Template.Score, Valid: true}
			margin = sql.NullFloat64{Float64: f.Template.Margin, Valid: true}
		}
		if _, err := tx.Exec(
			`INSERT INTO screenshot_field_evidence
			   (screenshots_dir_id, filename, field, x, y, width, height, template_value, template_score, template_margin)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			dirID, filename, string(f.Field), f.Rect.Min.X, f.Rect.Min.Y, f.Rect.Dx(), f.Rect.Dy(), value, score, margin,
		); err != nil {
			return err
		}
	}
	return nil
}

// LoadFieldEvidence reads every screenshot's evidence record, fields ordered
// by path. One bulk read, like LoadAll, so a caller folding many screenshots
// never queries per file — and like LoadAll, both tables are read in one
// transaction: a re-parse committing between two pooled reads would pair one
// parse's image size with another's regions.
func (s *SQLStore) LoadFieldEvidence() (map[FileRef]ScreenshotEvidence, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, fmt.Errorf("load field evidence: %w", err)
	}
	// Read-only usage; Rollback just releases the snapshot.
	defer func() { _ = tx.Rollback() }()
	out, err := loadFieldEvidence(tx)
	if err != nil {
		return nil, fmt.Errorf("load field evidence: %w", err)
	}
	return out, nil
}

// loadFieldEvidence reads both evidence tables through q, which the caller
// holds in one transaction.
func loadFieldEvidence(q querier) (map[FileRef]ScreenshotEvidence, error) {
	out, err := loadScreenshotImages(q)
	if err != nil {
		return nil, err
	}
	if err := attachFieldEvidence(q, out); err != nil {
		return nil, err
	}
	return out, nil
}

func loadScreenshotImages(q querier) (map[FileRef]ScreenshotEvidence, error) {
	rows, err := q.Query(`SELECT screenshots_dir_id, filename, width, height FROM screenshot_images`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[FileRef]ScreenshotEvidence{}
	for rows.Next() {
		var file FileRef
		var ev ScreenshotEvidence
		if err := rows.Scan(&file.DirID, &file.Filename, &ev.ImageSize.X, &ev.ImageSize.Y); err != nil {
			return nil, err
		}
		out[file] = ev
	}
	return out, rows.Err()
}

func attachFieldEvidence(q querier, into map[FileRef]ScreenshotEvidence) error {
	rows, err := q.Query(
		`SELECT screenshots_dir_id, filename, field, x, y, width, height, template_value, template_score, template_margin
		 FROM screenshot_field_evidence ORDER BY screenshots_dir_id, filename, field`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		file, field, err := scanFieldEvidence(rows)
		if err != nil {
			return err
		}
		ev := into[file]
		ev.Fields = append(ev.Fields, field)
		into[file] = ev
	}
	return rows.Err()
}

func scanFieldEvidence(rows *sql.Rows) (FileRef, parser.FieldEvidence, error) {
	var file FileRef
	var field string
	var x, y, width, height int
	var value sql.NullString
	var score, margin sql.NullFloat64
	if err := rows.Scan(&file.DirID, &file.Filename, &field, &x, &y, &width, &height, &value, &score, &margin); err != nil {
		return FileRef{}, parser.FieldEvidence{}, err
	}
	out := parser.FieldEvidence{Field: parser.FieldPath(field), Rect: image.Rect(x, y, x+width, y+height)}
	if value.Valid {
		out.Template = &parser.TemplateReading{Value: value.String, Score: score.Float64, Margin: margin.Float64}
	}
	return file, out, nil
}
