package seed

import (
	"fmt"

	"recall/pkg/db"
	"recall/pkg/fixtures"
)

// writeFixture persists every record kind in a fixtures.Fixture to the store.
// Each kind is one branch-free step over the shared writeAll loop, so adding a
// record kind is one more table entry.
func writeFixture(store db.Store, fx fixtures.Fixture) error {
	steps := []func() error{
		func() error {
			return writeAll("UpsertSummary", fx.Summaries,
				func(r db.SummaryRow) string { return r.MatchKey }, store.UpsertSummary)
		},
		func() error {
			return writeAll("UpsertTeams", fx.Teams,
				func(r db.TeamsRow) string { return r.MatchKey }, store.UpsertTeams)
		},
		func() error {
			return writeAll("UpsertPersonal", fx.Personals,
				func(r db.PersonalRow) string { return r.MatchKey }, store.UpsertPersonal)
		},
		func() error {
			return writeAll("UpsertRank", fx.Ranks,
				func(r db.RankRow) string { return r.MatchKey }, store.UpsertRank)
		},
		func() error {
			return writeAll("SetReview", fx.Reviews,
				func(r fixtures.ReviewSeed) string { return r.MatchKey },
				func(r fixtures.ReviewSeed) error { return store.SetReview(r.MatchKey, r.ReviewedBy) })
		},
		func() error {
			return writeAll("SetAnnotation", fx.Annotations,
				func(ann db.Annotation) string { return ann.MatchKey }, store.SetAnnotation)
		},
		func() error {
			return writeAll("SetMatchQueue", fx.Queues,
				func(q fixtures.QueueSeed) string { return q.MatchKey },
				func(q fixtures.QueueSeed) error { return store.SetMatchQueue(q.MatchKey, q.QueueType) })
		},
		func() error {
			return writeAll("SetMatchPlayMode", fx.PlayModes,
				func(pm fixtures.PlayModeSeed) string { return pm.MatchKey },
				func(pm fixtures.PlayModeSeed) error { return store.SetMatchPlayMode(pm.MatchKey, pm.PlayMode) })
		},
		func() error {
			return writeAll("UpsertUnknown", fx.Unknowns,
				func(u db.UnknownRow) string { return u.Filename }, store.UpsertUnknown)
		},
		func() error {
			return writeAll("ApplyAmbiguity", fx.Ambiguous,
				func(a fixtures.AmbiguousSeed) string { return a.Filename },
				func(a fixtures.AmbiguousSeed) error { return store.ApplyAmbiguity(a.Filename, a.Candidates) })
		},
		func() error {
			return writeAll("UpsertUserMatchData", fx.UserData,
				func(ud db.UserMatchData) string { return ud.MatchKey }, store.UpsertUserMatchData)
		},
	}
	for _, step := range steps {
		if err := step(); err != nil {
			return err
		}
	}
	return nil
}

// writeAll persists each record via write, wrapping the first failure with the
// store operation's name and the record's identity (match key or filename).
func writeAll[T any](op string, records []T, identity func(T) string, write func(T) error) error {
	for _, r := range records {
		if err := write(r); err != nil {
			return fmt.Errorf("%s(%s): %w", op, identity(r), err)
		}
	}
	return nil
}
