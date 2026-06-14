package applog

import "log/slog"

// Test-only bridges for the external applog_test package. formatFromEnv (env →
// handler format) and the slogWriter adapter (routes stdlib log through slog)
// have no public entry point; compiled only under test, so they widen no API.

// FormatFromEnv exposes formatFromEnv to black-box tests.
var FormatFromEnv = formatFromEnv

// NewSlogWriter builds the stdlib-log→slog adapter at the given level. A
// constructor (not a type alias) because slogWriter.level is unexported.
func NewSlogWriter(level slog.Level) slogWriter { return slogWriter{level: level} }
