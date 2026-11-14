// SPDX-License-Identifier: Apache-2.0

// Package db owns the SQLite persistence layer for Recall. The Store
// interface is the boundary the app uses; SQLStore is the production
// implementation.
//
// Schema is 3NF: one parent table per screenshot type (SUMMARY,
// TEAMS, PERSONAL, RANK, UNKNOWN) plus per-parent child tables
// for the repeating-group fields (heroes_played, modifiers, sr, hero
// stats). Each screenshot's parse writes to its own parent + children
// in one transaction; aggregation is read-time only.
//
// Schema is a single embedded file at `pkg/db/schema.sql` applied by
// `applySchema` on every `NewSQLStore`. Pre-1.0 the project uses a
// "wipe + relaunch" model — when the schema changes incompatibly
// the operator wipes the DB (CONTRIBUTING.md carries the per-platform
// path).
//
// The migration framework in `migrate.go` is scaffolded but
// intentionally inert: `pkg/db/migrations/` ships with no
// `.up.sql` / `.down.sql` pairs pre-1.0, so `applyMigrations` is a
// no-op on every store open. Once 1.0 lands and the schema is
// stable, schema changes go in as versioned migration pairs and the
// runner picks them up automatically.
package db

import (
	"database/sql"
	"errors"
	"fmt"
)

// parentTables enumerates every parent screenshot table. Used by
// LoadAllFilenames, Clear, and the aggregator to iterate uniformly.
var parentTables = []string{
	"summary_screenshots",
	"teams_screenshots",
	"personal_screenshots",
	"rank_screenshots",
	"unknown_screenshots",
}

// matchKeyTables is every table that names a match by its match_key and is
// NOT reached through a parent's cascade. One list, because match_key is the
// match's identity and a match can be RENAMED — resolving an ambiguous
// screenshot does exactly that — so anything missing here is silently
// stranded on a key nothing will look up again.
//
// It is deliberately not "every table with a match_key column":
//
//   - The user_match_* children, the match_annotation_* children and
//     self_review_notes reach their key through a parent FK declared
//     ON UPDATE CASCADE, so renaming the parent renames them. Listing them
//     here would be a second, competing write.
//   - coach_notes is excluded on purpose. Its match_key belongs to ANOTHER
//     player's corpus — it is what this user, as a coach, wrote about a
//     loaned match. Renaming one of our own keys must not touch it.
//
// storeSchemaCompletenessTest pins this against schema.sql, so a new table
// with a match_key column fails the build rather than going quietly missing.
var matchKeyTables = []string{
	"summary_screenshots",
	"teams_screenshots",
	"personal_screenshots",
	"rank_screenshots",
	"unknown_screenshots",
	"ambiguous_candidates",
	"hidden_matches",
	"acknowledged_reference_gaps",
	"pinned_matches",
	"match_annotations",
	"match_moments",
	"match_reviews",
	"match_queue",
	"match_play_mode",
	"match_coach_notes",
	"self_review_matches",
	"share_export_matches",
	"user_match_data",
	"duplicate_matches",
}

// secondaryMatchKeyColumns is every column that names a match by something
// OTHER than `match_key`. matchKeyTables above is keyed on the column NAME,
// and storeSchemaCompletenessTest can only see columns that carry it — so a
// column like duplicate_matches.duplicate_of is invisible to both, and a
// rename would strand it on a dead key while its card went on claiming a
// duplicate. There is one today; the point of the list is that the next one
// has somewhere to go.
var secondaryMatchKeyColumns = []struct{ table, column string }{
	{"duplicate_matches", "duplicate_of"},
}

// conn is the handle every SQLStore method runs its SQL through: the pooled
// database, or — inside InTransaction — one open transaction. A method that
// opens its own transaction gets a real one on the database and a savepoint
// inside an outer transaction, so the same method body is atomic on its own
// and composes into a larger unit without knowing which.
type conn interface {
	Exec(query string, args ...any) (sql.Result, error)
	Query(query string, args ...any) (*sql.Rows, error)
	QueryRow(query string, args ...any) *sql.Row
	Begin() (txn, error)
}

// txn is one unit of work a method commits or rolls back.
type txn interface {
	Exec(query string, args ...any) (sql.Result, error)
	Query(query string, args ...any) (*sql.Rows, error)
	QueryRow(query string, args ...any) *sql.Row
	Commit() error
	Rollback() error
}

// poolConn is the database itself.
type poolConn struct{ *sql.DB }

func (c poolConn) Begin() (txn, error) { return c.DB.Begin() }

// txConn is one open transaction, shared by every call inside InTransaction.
type txConn struct {
	*sql.Tx
	savepoints *int
}

// Begin opens a savepoint: the inner method's commit releases it, its
// rollback undoes only its own writes, and nothing is durable until the
// outer transaction commits.
func (c txConn) Begin() (txn, error) {
	*c.savepoints++
	name := fmt.Sprintf("sp_%d", *c.savepoints)
	if _, err := c.Exec("SAVEPOINT " + name); err != nil {
		return nil, err
	}
	return &savepoint{tx: c.Tx, name: name}, nil
}

// savepoint is a txn nested in an outer transaction.
type savepoint struct {
	tx   *sql.Tx
	name string
	done bool
}

func (s *savepoint) Exec(query string, args ...any) (sql.Result, error) {
	return s.tx.Exec(query, args...)
}

func (s *savepoint) Query(query string, args ...any) (*sql.Rows, error) {
	return s.tx.Query(query, args...)
}

func (s *savepoint) QueryRow(query string, args ...any) *sql.Row {
	return s.tx.QueryRow(query, args...)
}

func (s *savepoint) Commit() error {
	if s.done {
		return sql.ErrTxDone
	}
	s.done = true
	_, err := s.tx.Exec("RELEASE " + s.name)
	return err
}

// Rollback undoes the savepoint's writes; after a commit it is the no-op
// every deferred rollback in this package relies on.
func (s *savepoint) Rollback() error {
	if s.done {
		return sql.ErrTxDone
	}
	s.done = true
	if _, err := s.tx.Exec("ROLLBACK TO " + s.name); err != nil {
		return err
	}
	_, err := s.tx.Exec("RELEASE " + s.name)
	return err
}

// ErrNestedTransaction refuses an InTransaction inside another: the outer
// one is already the unit, and a second would only hide that.
var ErrNestedTransaction = errors.New("db: already inside a transaction")

// InTransaction runs fn against a Store whose every write lands in one
// transaction: committed when fn returns nil, rolled back whole when it
// returns an error (or panics). The Store fn receives is valid only inside
// fn.
func (s *SQLStore) InTransaction(fn func(Store) error) (err error) {
	pool, ok := s.db.(poolConn)
	if !ok {
		return ErrNestedTransaction
	}
	tx, err := pool.DB.Begin()
	if err != nil {
		return err
	}
	defer func() {
		if r := recover(); r != nil {
			_ = tx.Rollback()
			panic(r)
		}
	}()
	inner := &SQLStore{db: txConn{Tx: tx, savepoints: new(int)}, path: s.path}
	if err := fn(inner); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}
