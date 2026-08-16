package app

import (
	"recall/pkg/coach"
	"recall/pkg/db"
)

// pkg/coach declares its persistence needs as two consumer-side interfaces
// so a session can never reach the received layer and an accept can never
// reach the authored one. db.Store satisfies both; these assertions break
// the build here — at the seam — rather than at the call site if either
// side drifts.
var (
	_ coach.NoteStore   = (db.Store)(nil)
	_ coach.ReturnStore = (db.Store)(nil)
)
