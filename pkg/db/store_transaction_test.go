package db_test

import (
	"errors"
	"testing"

	"recall/pkg/db"
)

var errAbort = errors.New("abort")

// InTransaction is one unit on both stores: everything fn wrote lands, or —
// when fn fails — nothing does, including writes made by methods that open a
// transaction of their own.
func TestStoreContract_InTransactionCommitsOrRollsBackWhole(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			err := s.InTransaction(func(tx db.Store) error {
				if err := writeMatchAndReview(tx, "match-rolled-back"); err != nil {
					return err
				}
				return errAbort
			})
			if !errors.Is(err, errAbort) {
				t.Fatalf("InTransaction = %v, want fn's error", err)
			}
			mustNoErr(t, s.InTransaction(func(tx db.Store) error { return writeMatchAndReview(tx, "match-kept") }))

			if match, review := tracesOf(t, s, "match-rolled-back"); match || review {
				t.Error("a failed transaction left its writes behind")
			}
			if match, review := tracesOf(t, s, "match-kept"); !match || !review {
				t.Error("a committed transaction lost its writes")
			}
		})
	}
}

// writeMatchAndReview makes two writes, the first of them a method that
// opens a transaction of its own.
func writeMatchAndReview(tx db.Store, key string) error {
	if err := tx.UpsertSummary(db.SummaryRow{Filename: key + ".png", MatchKey: key, Map: "ilios"}); err != nil {
		return err
	}
	return tx.SetReview(key, "self")
}

// tracesOf reports whether key's match row and its review are stored.
func tracesOf(t *testing.T, s db.Store, key string) (match, review bool) {
	t.Helper()
	keys, err := s.LoadMatchKeys()
	mustNoErr(t, err)
	reviews, err := s.LoadReviews()
	mustNoErr(t, err)
	return keys[key], reviews[key].ReviewedBy == "self"
}

// A method that fails inside the transaction undoes only its own writes; fn
// decides whether the whole unit goes.
func TestStoreContract_AFailedCallInsideATransactionUndoesOnlyItself(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			mustNoErr(t, s.InTransaction(func(tx db.Store) error {
				mustNoErr(t, tx.SetReview("match-a", "self"))
				if err := tx.SetReview("match-b", "nobody"); err == nil {
					t.Error("a reviewer outside the vocabulary was accepted")
				}
				return nil
			}))
			reviews, err := s.LoadReviews()
			mustNoErr(t, err)
			if reviews["match-a"].ReviewedBy != "self" || reviews["match-b"].ReviewedBy != "" {
				t.Errorf("reviews = %+v, want only match-a", reviews)
			}
		})
	}
}

func TestStoreContract_ATransactionDoesNotNest(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			err := s.InTransaction(func(tx db.Store) error {
				return tx.InTransaction(func(db.Store) error { return nil })
			})
			if !errors.Is(err, db.ErrNestedTransaction) {
				t.Errorf("nested InTransaction = %v, want ErrNestedTransaction", err)
			}
		})
	}
}
