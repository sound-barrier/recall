package cmd

import (
	"encoding/json"
	"errors"
	"net/http"

	"recall/pkg/app"
	"recall/pkg/applog"
	"recall/pkg/bundle"
	"recall/pkg/coach"
	"recall/pkg/coachreturn"
	"recall/pkg/db"
	"recall/pkg/match"
	"recall/pkg/review"
)

// RFC 9457 problem+json errors — the one place an app-layer error becomes
// an HTTP status.
//
// Every 4xx/5xx is an application/problem+json object (RFC 9457). `type` is a
// stable URI under problemBase that integrators can switch on; `instance` is the
// request path. Extension members (§3.2: errors, failed_assets) carry domain
// detail. The desktop Wails path returns Go errors directly and never reaches
// here — this is the HTTP/server contract only.
//
// Handlers reach it through writeError (or writeArchiveError for the two
// endpoints a user hands a file to), never by spelling out their own
// errors.Is ladder: a sentinel that means the same thing on every route it
// can reach belongs in defaultProblems below, so a new route inherits the
// whole 400/404/409 ladder instead of re-deriving part of it.

const problemBase = "https://github.com/sound-barrier/recall/problems/"

// problemType is one stable problem class: a slug (→ the type URI), a
// human-readable title, and the HTTP status it carries.
type problemType struct {
	slug   string
	title  string
	status int
}

var (
	probInvalidBody = problemType{"invalid-body", "Bad Request", http.StatusBadRequest}
	probNotFound    = problemType{"not-found", "Not Found", http.StatusNotFound}
	probConflict    = problemType{"conflict", "Conflict", http.StatusConflict}
	// Self-update isn't possible on this install (server mode, dev build,
	// macOS, or an unwritable install dir). 409 not 400: the request is
	// well-formed, the server just can't act on it here.
	probSelfUpdateUnavailable = problemType{"self-update-unavailable", "Conflict", http.StatusConflict}
	probDataVerify            = problemType{"data-verification-failed", "Unprocessable Entity", http.StatusUnprocessableEntity}
	probRestoreInvalid        = problemType{"restore-invalid", "Unprocessable Entity", http.StatusUnprocessableEntity}
	probBadGateway            = problemType{"upstream-fetch-failed", "Bad Gateway", http.StatusBadGateway}
	probInternal              = problemType{"internal", "Internal Server Error", http.StatusInternalServerError}
)

// fieldError is one entry in the `errors` extension member — a single offending
// request field and why it was rejected.
type fieldError struct {
	Field  string `json:"field"`
	Detail string `json:"detail"`
}

// problemDetails is the RFC 9457 object. type/title/status are always present;
// detail/instance and the extension members omit when empty.
type problemDetails struct {
	Type         string       `json:"type"`
	Title        string       `json:"title"`
	Status       int          `json:"status"`
	Detail       string       `json:"detail,omitempty"`
	Instance     string       `json:"instance,omitempty"`
	Errors       []fieldError `json:"errors,omitempty"`
	FailedAssets []string     `json:"failed_assets,omitempty"`
}

// problemOpt attaches an RFC 9457 §3.2 extension member to a problem.
type problemOpt func(*problemDetails)

func withFieldErrors(errs ...fieldError) problemOpt {
	return func(p *problemDetails) { p.Errors = append(p.Errors, errs...) }
}

func withFailedAssets(assets ...string) problemOpt {
	return func(p *problemDetails) { p.FailedAssets = append(p.FailedAssets, assets...) }
}

// writeProblem emits one application/problem+json response for pt, with the
// human-readable detail and the request path as `instance`.
func writeProblem(w http.ResponseWriter, r *http.Request, pt problemType, detail string, opts ...problemOpt) {
	p := problemDetails{
		Type:     problemBase + pt.slug,
		Title:    pt.title,
		Status:   pt.status,
		Detail:   detail,
		Instance: r.URL.Path,
	}
	for _, o := range opts {
		o(&p)
	}
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(pt.status)
	if encErr := json.NewEncoder(w).Encode(p); encErr != nil {
		applog.Subsystem("server").Error("problem encode", "err", encErr)
	}
}

// writeJSON encodes v as JSON. If err is non-nil it writes a 500 problem instead.
func writeJSON(w http.ResponseWriter, r *http.Request, v any, err error) {
	if err != nil {
		writeProblem(w, r, probInternal, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if encErr := json.NewEncoder(w).Encode(v); encErr != nil {
		applog.Subsystem("server").Error("json encode", "err", encErr)
	}
}

// errStatus pairs an app-layer sentinel error with the problem type that
// writeError maps it to.
type errStatus struct {
	is error
	pt problemType
}

// defaultProblems is the fallback ladder writeError consults after a
// handler's own cases: the sentinels whose HTTP meaning is identical on
// every route that can raise them, so no handler has to re-derive it and
// none can quietly map one differently. The per-match unknown-key guard and
// the coaching-session vocabulary both reach nearly every write path — the
// guard because any sidecar write can name a key this database has never
// seen, the session because the write gate refuses every mutating
// orchestrator while one is open — and repeating those rungs per handler is
// how one of them ends up missing.
//
// Order is checked top-down, so a doubly-wrapped error resolves to the
// first rung it matches; the rungs below are mutually exclusive today.
var defaultProblems = []errStatus{
	// 404 — the resource named in the URL isn't here.
	{match.ErrMatchNotFound, probNotFound},
	{coach.ErrNoSession, probNotFound},
	{coach.ErrMatchNotInSession, probNotFound},
	{db.ErrCoachReturnUnknown, probNotFound},
	{db.ErrMatchCoachNoteUnknown, probNotFound},
	{review.ErrNotFound, probNotFound},
	{review.ErrMatchNotInReview, probNotFound},
	{db.ErrFocusItemUnknown, probNotFound},

	// Two rungs out of order on purpose, for the wrapped chains:
	//   - a notes ARCHIVE whose note fails the kind rules wraps ErrNoteShape
	//     inside ErrNotesMalformed, and the archive as a whole is what the
	//     import refuses — a malformed upload, 400 — so ErrNotesMalformed sits
	//     above ErrNoteShape;
	//   - a live note write whose kind and content disagree wraps only
	//     ErrNoteInvalid, and the semantic refusal (409) must beat the 400
	//     that sentinel carries below.
	{coach.ErrNotesMalformed, probInvalidBody},
	{coach.ErrNoteShape, probConflict},

	// 400 — the request body doesn't hold up.
	// An empty match key is malformed input, not a server fault. The
	// per-match routes never reach it (matchKeyFromPath rejects an empty
	// path value first), but the Wails desktop bindings call the same App
	// methods with no such guard — and unmapped, this fell through to 500.
	{app.ErrMatchKeyRequired, probInvalidBody},
	{coach.ErrNoteInvalid, probInvalidBody},
	{coach.ErrFocusItemInvalid, probInvalidBody},
	{db.ErrFocusItemStatusInvalid, probInvalidBody},
	{coach.ErrHandleInvalid, probInvalidBody},
	{app.ErrCoachNameInvalid, probInvalidBody},
	{review.ErrTitleInvalid, probInvalidBody},
	{review.ErrTooManyMatches, probInvalidBody},
	// A batch that would create more matches than a coaching session
	// plausibly reviews. 400 rather than 409 because the refusal is about
	// the SIZE of what was asked for, not about the state it was asked in.
	{coachreturn.ErrTooManyCreated, probInvalidBody},

	// 409 — the body parses, the state or its semantics refuse the action.
	{coach.ErrSessionActive, probConflict},
	{bundle.ErrCoachBundle, probConflict},
	{coach.ErrNotABundle, probConflict},
	{coach.ErrNotesUnsupportedSchema, probConflict},
	{coachreturn.ErrNoMatches, probConflict},
	{coachreturn.ErrOrphan, probConflict},
	// A replay code names one match, and the schema enforces it. Without
	// this the constraint surfaces as a 500 carrying SQLite's own words,
	// which the user cannot act on.
	{app.ErrReplayCodeTaken, probConflict},
	{coach.ErrHandleRequired, probConflict},
	{coach.ErrCoachNameRequired, probConflict},
	{coach.ErrNothingToExport, probConflict},
	{review.ErrNoMatches, probConflict},
	// Reachable from BOTH coach-player paths — opening a session on a bundle
	// and confirming the handle by hand — which is why it sits here rather
	// than on either handler.
	{db.ErrCoachHandleAmbiguous, probConflict},
	// The dossier endpoint's 404: a player ref the roster does not carry.
	{db.ErrCoachPlayerUnknown, probNotFound},
	// A bundle names its player; only a codes session can be a team review.
	{coach.ErrBundleNamesPlayer, probConflict},
	// A team review travels as the page — the archive has no addressee.
	{coach.ErrTeamPageOnly, probConflict},
	{db.ErrCoachKindInvalid, probInvalidBody},
}

// writeError writes err to w as an RFC 9457 problem and reports whether it wrote
// anything. A nil err writes nothing and returns false, so a handler can guard
// its happy path with `if writeError(w, r, a.Foo(), …) { return }`. For a
// non-nil err, the first sentinel in cases that err matches (errors.Is) selects
// the problem type; failing that, defaultProblems is consulted; an err matching
// neither falls through to a 500 internal problem. This keeps the "known
// sentinel → 4xx, everything else → 500" ladder in one place instead of
// repeating it in every write handler.
func writeError(w http.ResponseWriter, r *http.Request, err error, cases ...errStatus) bool {
	if err == nil {
		return false
	}
	if pt, ok := matchProblem(err, cases); ok {
		writeProblem(w, r, pt, err.Error())
		return true
	}
	if pt, ok := matchProblem(err, defaultProblems); ok {
		writeProblem(w, r, pt, err.Error())
		return true
	}
	writeProblem(w, r, probInternal, err.Error())
	return true
}

// writeArchiveError answers the two endpoints a user hands a file to —
// POST /api/v1/imports and POST /api/v1/coach/session — with the split
// their payloads earn: bytes that are not a readable archive are a 400,
// and everything past that gate (an unsupported schema, a bundle shared
// for coaching, a session already open, a read-only profile) is a 409.
// Deliberately without writeError's 500 rung: a schema this build does not
// speak carries no sentinel to match on, and answering 500 for a file the
// user chose reads as a crash rather than a refusal.
func writeArchiveError(w http.ResponseWriter, r *http.Request, err error) bool {
	if err == nil {
		return false
	}
	pt := probConflict
	if errors.Is(err, app.ErrImportMalformed) {
		pt = probInvalidBody
	} else if mapped, ok := matchProblem(err, defaultProblems); ok {
		pt = mapped
	}
	writeProblem(w, r, pt, err.Error())
	return true
}

// matchProblem returns the problem type of the first case err matches.
func matchProblem(err error, cases []errStatus) (problemType, bool) {
	for _, c := range cases {
		if errors.Is(err, c.is) {
			return c.pt, true
		}
	}
	return problemType{}, false
}
