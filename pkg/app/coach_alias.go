package app

import (
	"recall/pkg/coach"
	"recall/pkg/coachreturn"
	"recall/pkg/db"
)

// The two halves of the coach exchange declare their persistence needs
// separately, so a session can never reach the received layer and an accept can
// never reach the authored one. That used to be a convention held by two
// interfaces in one package; it is a package boundary now — pkg/coachreturn
// imports pkg/coach for the archive format and nothing points back — so the
// separation is enforced by the compiler rather than by care.
//
// db.Store satisfies both. These assertions break the build here, at the seam,
// rather than at some call site, if either side drifts.
var (
	_ coach.NoteStore   = (db.Store)(nil)
	_ coachreturn.Store = (db.Store)(nil)
)
