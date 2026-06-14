package cmd_test

import (
	"net/http"
	"testing"

	"recall/pkg/cmd"
	"recall/pkg/db/dbtest"
	"recall/pkg/match"
)

// Handler-level gap coverage for the seven /matches/* routes wired
// in server_matches.go. The bulk of these endpoints already have
// happy-path + sentinel-error tests scattered across server_test.go,
// server_get_by_key_test.go, server_matches_pagination_test.go,
// server_review_test.go, and method_not_allowed_test.go. This file
// pins the branches that fall out of those suites:
//
//   - GET    /matches            — unknown query param → 400 via
//     validateMatchesQueryParams (today only exercised by the
//     schemathesis fuzzer in CI).
//   - POST   /matches/transfers  — malformed JSON body → 400.
//   - PUT    /matches/{k}/resolution — malformed JSON body → 400.
//   - PUT    /matches/{k}/annotation — malformed JSON body → 400.
//   - PUT    /matches/{k}/annotation — literal `null` body → 400.
//     This is the schemathesis-driven branch the handler reads the
//     body up-front for; without coverage a refactor that drops the
//     up-front bytes.Equal check would silently regress to 204.
//   - applyMatchesPagination — cursor that doesn't match any row
//     returns the full corpus from the start (back-compat: an
//     unknown cursor must not silently return an empty page).

// ───────────────────────────────────────────────────────────────────
// GET /api/v1/matches — query-param validation.
// ───────────────────────────────────────────────────────────────────

func TestGetMatches_UnknownQueryParam_400(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := get(t, mux, "/api/v1/matches?Limit=10")
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 (unknown query param must reject)", rec.Code)
	}
}

// ───────────────────────────────────────────────────────────────────
// POST /api/v1/matches/transfers — body decode failures.
// ───────────────────────────────────────────────────────────────────

func TestPostMatchTransfers_InvalidJSON_400(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := postRaw(t, mux, "/api/v1/matches/transfers", "{not json")
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 (malformed JSON must reject)", rec.Code)
	}
}

// ───────────────────────────────────────────────────────────────────
// PUT /api/v1/matches/{k}/resolution — body decode failure.
// ───────────────────────────────────────────────────────────────────

func TestMatchResolution_InvalidJSON_400(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := putRaw(t, mux, resolutionPath("ambiguous-foo.png"), "{not json")
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 (malformed JSON must reject)", rec.Code)
	}
}

// ───────────────────────────────────────────────────────────────────
// PUT /api/v1/matches/{k}/annotation — null + malformed body.
// ───────────────────────────────────────────────────────────────────

func TestMatchAnnotations_InvalidJSON_400(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := putRaw(t, mux, annotationPath("match-2026-05-10T22-21-11"), "{not json")
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 (malformed JSON must reject)", rec.Code)
	}
}

// Body that is the literal JSON token `null` must reject — Go's json
// silently decodes it into the zero-value struct, after which the
// "all-empty fields → delete annotation" rule would otherwise return
// 204. Schemathesis's negative_data_rejection check caught this; the
// handler now reads the body up-front and rejects null explicitly.
func TestMatchAnnotations_NullBody_400(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := putRaw(t, mux, annotationPath("match-2026-05-10T22-21-11"), "null")
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 (literal null body must reject)", rec.Code)
	}
}

// ───────────────────────────────────────────────────────────────────
// applyMatchesPagination — unknown cursor.
// ───────────────────────────────────────────────────────────────────

// An unknown cursor (no row's MatchKey equals it) must fall through
// to start=0 — i.e. return the corpus from the beginning, not an
// empty page. This pins the back-compat: a cursor pointing at a row
// that has since been deleted shouldn't strand the caller on an
// empty list.
func TestApplyMatchesPagination_UnknownCursorReturnsFromStart(t *testing.T) {
	rows := []match.MatchRecord{
		{MatchKey: "m1"},
		{MatchKey: "m2"},
		{MatchKey: "m3"},
	}
	out := cmd.ApplyMatchesPagination(rows, 0, "does-not-exist")
	if len(out) != 3 {
		t.Errorf("unknown cursor returned %d rows, want 3 (full corpus from start)", len(out))
	}
}

// Belt-and-suspenders: limit alongside an unknown cursor still slices
// from the start so the caller gets a real page rather than nothing.
func TestApplyMatchesPagination_UnknownCursorWithLimitSlicesFromStart(t *testing.T) {
	rows := []match.MatchRecord{
		{MatchKey: "m1"},
		{MatchKey: "m2"},
		{MatchKey: "m3"},
	}
	out := cmd.ApplyMatchesPagination(rows, 2, "does-not-exist")
	if len(out) != 2 {
		t.Errorf("got %d rows, want 2 (limit applied from start)", len(out))
	}
	if len(out) > 0 && out[0].MatchKey != "m1" {
		t.Errorf("got first key %q, want m1", out[0].MatchKey)
	}
}

// ───────────────────────────────────────────────────────────────────
// DELETE /api/v1/matches/{k} — Fake-backed reachability check.
// ───────────────────────────────────────────────────────────────────

// server_test.go::TestServerMux_DeleteSingleMatch_DelegatesToStore
// already pins HardDeleteMatch's pass-through to the store; this
// repeats it from the route's vantage so a future change to the
// {match_key} pattern (e.g. swapping it for {key}) trips at unit-test
// time rather than waiting for the e2e.
func TestDeleteSingleMatch_RoutesAndDelegates(t *testing.T) {
	fs := dbtest.New()
	_, mux := newTestApp(t, fs)
	rec := del(t, mux, "/api/v1/matches/match-2026-05-10T22-21-11")
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	if len(fs.HardDeleteCalls) != 1 || fs.HardDeleteCalls[0] != "match-2026-05-10T22-21-11" {
		t.Errorf("HardDeleteCalls = %v, want [match-2026-05-10T22-21-11]", fs.HardDeleteCalls)
	}
}
