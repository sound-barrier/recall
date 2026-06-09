# Migrations

Empty pre-1.0. Schema lives in `../schema.sql`, applied verbatim on
every `NewSQLStore`.

Once 1.0 lands and the schema is stable, schema changes go here as
versioned `NNNN_<name>.up.sql` / `NNNN_<name>.down.sql` pairs. The
migration runner in `../migrate.go` picks them up automatically —
no other wiring needed.

Conventions, when migrations start shipping:

- Version is the leading integer in the filename, parsed as int and
  applied in ascending order.
- Statements inside one file are separated by a whole-line
  `-- statement-end` sentinel; the runner splits on that token and
  executes each piece via a single `Exec` call.
- Each migration runs in its own transaction.
- Every `.up.sql` requires a paired `.down.sql`. The `.down.sql` is
  exercised by `TestMigrationsRoundTrip` so a bad rollback fails CI,
  not production.

This `README.md` is embedded by `//go:embed migrations` and ignored
by `loadMigrations` (suffix filter). Don't rename it without
updating the embed pattern.
