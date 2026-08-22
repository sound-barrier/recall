package app

import (
	"time"

	"recall/pkg/coach"
)

// Coaching from replay codes: the session with no bundle behind it.
//
// A coach handed six characters has everything they need to WATCH the match
// and nothing the app can show them, so this session's corpus is a list of
// empty frames the coach fills in as they go. Everything downstream — the
// room, the notes, the moments, the focus list, the export — is the same
// machinery a bundle session uses, because it is the same coaching.
//
// The one design rule that does NOT bend: this still takes the single session
// slot and still freezes the coach's own database, exactly as a bundle
// session does. A coach reviewing somebody else's replay has no business
// writing their own history mid-session, and one rule is easier to keep than
// two.

// OpenCoachReplaySession opens a session from replay codes alone.
func (a *App) OpenCoachReplaySession(codes []string) (coach.SessionView, error) {
	view, err := a.claimCoachSessionWith(func(now time.Time) (*coach.Session, error) {
		return coach.OpenReplaySession(codes, now)
	}, time.Now())
	if err != nil {
		return coach.SessionView{}, err
	}
	a.emitCoachSessionChanged(true)
	return view, nil
}

// AddCoachSessionReplayCode grows an open replay session's reel.
//
// Codes arrive one at a time over voice chat, so the reel has to grow while
// the coach is working rather than being fixed at open.
func (a *App) AddCoachSessionReplayCode(code string) (coach.SessionView, error) {
	a.coachMu.Lock()
	defer a.coachMu.Unlock()
	s := a.coachSession
	if s == nil {
		return coach.SessionView{}, coach.ErrNoSession
	}
	if err := s.AddReplayCode(code); err != nil {
		return coach.SessionView{}, err
	}
	return a.coachViewLocked(time.Now())
}

// SetCoachSessionMatchContext records what the coach observed for one match.
//
// Nothing is persisted: the context lives on the in-memory record and travels
// to the player inside the notes archive. That is what keeps the session's
// "records never reach a store" rule true for a corpus the coach authored.
func (a *App) SetCoachSessionMatchContext(matchKey string, ctx coach.ObservedContext) (coach.SessionView, error) {
	a.coachMu.Lock()
	defer a.coachMu.Unlock()
	s := a.coachSession
	if s == nil {
		return coach.SessionView{}, coach.ErrNoSession
	}
	if err := s.SetObservedContext(matchKey, ctx); err != nil {
		return coach.SessionView{}, err
	}
	return a.coachViewLocked(time.Now())
}
