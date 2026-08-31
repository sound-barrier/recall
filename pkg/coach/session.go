package coach

import (
	"cmp"
	"slices"
	"time"

	"recall/pkg/aggregate"
	"recall/pkg/bundle"
	"recall/pkg/db"
	"recall/pkg/match"
)

// Player is who a session is about, on the wire: the stable id the
// player's export minted (empty for anonymous/older bundles), the display
// handle the coach confirms, and the player's message to the coach.
type Player struct {
	ID      string `json:"id"`
	Handle  string `json:"handle"`
	Message string `json:"message"`
	// Kind is db.CoachKindPlayer or db.CoachKindTeam. A bundle always names
	// a player; only a codes session can be confirmed as a team.
	Kind string `json:"kind"`
}

// Session is one open coaching session: the player's bundle rendered to
// records in memory, plus who it is about. The records are a read-only
// corpus — they never reach a store, and the App discards the whole
// Session on End.
type Session struct {
	// SessionID identifies this sitting for the coach's own history. Minted
	// at open rather than at end, because a sitting that is abandoned
	// without ending is still a sitting the dossier should show.
	SessionID string
	// Source is where the corpus came from, and it decides two things the
	// room needs to know: whether the coach may add matches (only a replay
	// session grows) and whether to offer the observed-context editor (only
	// a replay match has nothing parsed to show).
	Source SessionSource
	// Player is the identity the bundle suggested; the coach may correct
	// Handle before writing notes.
	Player Player
	// HandleFromBundle reports whether the bundle carried a handle at all
	// (a plain export did not, and the coach must supply one).
	HandleFromBundle bool
	// OpenedAt is when the session opened (RFC3339 UTC).
	OpenedAt string
	// ExportedAt and RecallVersion are the bundle's own provenance.
	ExportedAt    string
	RecallVersion string

	records    []match.Record
	indexByKey map[string]int
	playerRef  int64
}

// SessionSource distinguishes the two ways a session's corpus arrives.
type SessionSource string

const (
	// SessionFromBundle is the original: the player exported their matches
	// and the coach opened the file.
	SessionFromBundle SessionSource = "bundle"
	// SessionFromReplay is a corpus the coach typed: replay codes and
	// nothing else, with no screenshots and no parsed data behind them.
	SessionFromReplay SessionSource = "replay"
)

// SessionView is the session as GET/POST /coach/session return it.
type SessionView struct {
	Player           Player        `json:"player"`
	ExportedAt       string        `json:"exported_at"`
	SessionDate      string        `json:"session_date"`
	MatchCount       int           `json:"match_count"`
	CoachName        string        `json:"coach_name"`
	FocusItems       []FocusItem   `json:"focus_items"`
	Notes            []Note        `json:"notes"`
	HandleFromBundle bool          `json:"handle_from_bundle"`
	Source           SessionSource `json:"source"`
}

// OpenSession renders a player's bundle into a Session. A coach notes
// archive given by mistake is ErrNotABundle; anything bundle.Read refuses
// surfaces unchanged (bundle.ErrImportMalformed for unreadable input, a
// plain error for a schema this build does not speak).
func OpenSession(payload []byte, now time.Time) (*Session, error) {
	if SniffArchive(payload) == ArchiveCoachNotes {
		return nil, ErrNotABundle
	}
	contents, err := bundle.Read(payload)
	if err != nil {
		return nil, err
	}
	s := &Session{
		SessionID:     NewID(),
		OpenedAt:      now.UTC().Format(time.RFC3339),
		ExportedAt:    contents.Manifest.ExportedAt,
		RecallVersion: contents.Manifest.RecallVersion,
		Source:        SessionFromBundle,
	}
	s.Player.Kind = db.CoachKindPlayer
	if p := contents.Manifest.Player; p != nil {
		s.Player = Player{ID: p.ID, Handle: p.Handle, Message: p.Message, Kind: db.CoachKindPlayer}
		s.HandleFromBundle = p.Handle != ""
	}
	s.setRecords(BuildRecords(contents.Data))
	return s, nil
}

func (s *Session) setRecords(recs []match.Record) {
	s.records = recs
	s.indexByKey = make(map[string]int, len(recs))
	for i := range recs {
		s.indexByKey[recs[i].MatchKey] = i
	}
}

// Records returns the loaned corpus in GET /matches order (ascending
// match_key). The slice header is shared — treat it as read-only.
func (s *Session) Records() []match.Record { return s.records }

// HasMatch reports whether key is one of the session's matches.
func (s *Session) HasMatch(key string) bool {
	_, ok := s.indexByKey[key]
	return ok
}

// MatchCount is the number of matches in the corpus.
func (s *Session) MatchCount() int { return len(s.records) }

// PlayerRef is the coach_players row the App resolved for this session, or
// 0 until it has.
func (s *Session) PlayerRef() int64 { return s.playerRef }

// SetPlayerRef records the resolved coach_players row id.
func (s *Session) SetPlayerRef(id int64) { s.playerRef = id }

// MatchContextFor returns the descriptive snapshot of one of the session's
// matches, or nil when key is not in the corpus.
func (s *Session) MatchContextFor(key string) *MatchContext {
	i, ok := s.indexByKey[key]
	if !ok {
		return nil
	}
	rec := s.records[i]
	d := rec.Data
	ctx := &MatchContext{Map: d.Map, Hero: d.Hero, Result: d.Result, Date: d.Date, FinishedAt: d.FinishedAt}
	// The code rides along because for a replay match it is the ONLY thing
	// identifying what the note is about: the player may not have the match,
	// and this context is what it gets created from.
	if rec.Annotation != nil {
		ctx.ReplayCode = rec.Annotation.ReplayCode
	}
	return ctx
}

// View assembles the wire view of the session. session_date is the UTC
// date of the clock passed in, so the App decides "today" once.
func (s *Session) View(notes []Note, focus []FocusItem, coachName string, now time.Time) SessionView {
	if notes == nil {
		notes = []Note{}
	}
	if focus == nil {
		focus = []FocusItem{}
	}
	return SessionView{
		Player:           s.Player,
		ExportedAt:       s.ExportedAt,
		SessionDate:      SessionDate(now),
		MatchCount:       s.MatchCount(),
		CoachName:        coachName,
		FocusItems:       focus,
		Notes:            notes,
		HandleFromBundle: s.HandleFromBundle,
		Source:           s.Source,
	}
}

// SessionDate is the YYYY-MM-DD the session is dated with — the UTC date
// of the clock passed in.
func SessionDate(now time.Time) string { return now.UTC().Format(time.DateOnly) }

// BuildRecords runs the read path pkg/app runs against a store — fold,
// synthesize manual matches, attach every user layer, infer — over a
// bundle's data.json instead, with no store involved. Two deliberate
// departures from the store-backed path: no ambiguity candidates travel in
// a bundle, and ThumbnailFile / SourceDirIDs are blanked so nothing ever
// resolves a screenshot against the coach's disk.
func BuildRecords(d bundle.DataV2) []match.Record {
	snap := db.Screenshots{Summaries: d.Summaries, Teams: d.Teams, Personals: d.Personals, Ranks: d.Ranks, Unknowns: d.Unknowns}
	userData := indexUserMatchData(d.UserMatchData)
	recs := aggregate.Screenshots(snap)
	recs = aggregate.SynthesizeManualMatches(recs, userData)
	aggregate.AttachUserData(recs, userData)
	aggregate.AttachAnnotations(recs, indexAnnotations(d.Annotations))
	aggregate.AttachHidden(recs, keySet(d.Hidden))
	aggregate.AttachPinned(recs, keySet(d.Pinned))
	aggregate.AttachReviews(recs, d.Reviews)
	aggregate.AttachCoachNotes(recs, groupCoachNotes(d.CoachNotes))
	// The player's own words about their games ride the bundle too — their
	// timestamped moments and their self-review blocks — and the coach reads
	// them under their own note. Both went missing here once: the bundle
	// carried the moments and the room never attached them, and only the
	// fidelity test's fixture growing a moment made that visible.
	aggregate.AttachMatchMoments(recs, groupMatchMoments(d.Moments))
	aggregate.AttachSelfReviewNotes(recs, groupSelfReviewNotes(d.SelfReviews))
	aggregate.AttachQueues(recs, d.Queues)
	aggregate.AttachPlayModes(recs, d.PlayModes)
	aggregate.AttachAmbiguity(recs, nil)
	for i := range recs {
		aggregate.ApplyReadTimeInference(&recs[i].Data)
		recs[i].ThumbnailFile = ""
		recs[i].SourceDirIDs = nil
	}
	return recs
}

func indexUserMatchData(rows []db.UserMatchData) map[string]db.UserMatchData {
	out := make(map[string]db.UserMatchData, len(rows))
	for _, r := range rows {
		out[r.MatchKey] = r
	}
	return out
}

func indexAnnotations(rows []db.Annotation) map[string]db.Annotation {
	out := make(map[string]db.Annotation, len(rows))
	for _, r := range rows {
		out[r.MatchKey] = r
	}
	return out
}

func keySet(keys []string) map[string]bool {
	out := make(map[string]bool, len(keys))
	for _, k := range keys {
		out[k] = true
	}
	return out
}

func groupMatchMoments(rows []db.MatchMoment) map[string][]db.MatchMoment {
	out := make(map[string][]db.MatchMoment, len(rows))
	for _, r := range rows {
		out[r.MatchKey] = append(out[r.MatchKey], r)
	}
	// The store hands moments over in reading order (clock, then place);
	// the bundle sorts them by id for stable bytes, so re-sort here.
	for k := range out {
		slices.SortStableFunc(out[k], func(a, b db.MatchMoment) int {
			if c := cmp.Compare(a.MatchClock, b.MatchClock); c != 0 {
				return c
			}
			return cmp.Compare(a.SortOrder, b.SortOrder)
		})
	}
	return out
}

// groupSelfReviewNotes turns the bundle's sittings into the per-match view
// the aggregator reads — each note carrying its sitting's identity, sorted
// by sitting the way the store's own read is.
func groupSelfReviewNotes(reviews []db.SelfReview) map[string][]db.SelfReviewNoteOnMatch {
	out := map[string][]db.SelfReviewNoteOnMatch{}
	for _, r := range reviews {
		for k, n := range r.Notes {
			n.ReviewID = r.ReviewID
			out[k] = append(out[k], db.SelfReviewNoteOnMatch{
				SelfReviewNote: n, ReviewTitle: r.Title, ReviewCreatedAt: r.CreatedAt, ReviewFinishedAt: r.FinishedAt,
			})
		}
	}
	for k := range out {
		db.SortSelfReviewNotesBySitting(out[k])
	}
	return out
}

func groupCoachNotes(rows []db.MatchCoachNote) map[string][]db.MatchCoachNote {
	out := make(map[string][]db.MatchCoachNote, len(rows))
	for _, r := range rows {
		out[r.MatchKey] = append(out[r.MatchKey], r)
	}
	return out
}
