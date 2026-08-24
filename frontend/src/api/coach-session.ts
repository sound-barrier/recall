import { unwrap, unwrapVoid } from '@/api-unwrap'
import * as sdk from '@/client/sdk.gen'
import type {
  CoachMoment,
  CoachMomentInput,
  MatchMomentInput,
  CoachNote,
  CoachNoteInput,
  CoachSessionView,
  ObservedContext,
  FocusEntry,
  FocusItem,
  FocusStatus,
  MatchRecord,
} from '@/client/types.gen'

// Re-exported wire types — consumers import these instead of reaching into
// the generated module directly.

// ─── Coaching session (the coach's side) ───────────────────────────────────
//
// A session is server-side STATE, not a resource the client assembles:
// POST opens it from a bundle's bytes (OpenCoachBundle, on the platform
// seam because it needs a file picker), GET reads it, DELETE ends it and
// discards the loaned records. While one is open every mutating endpoint
// answers 409 — the coach is looking at somebody else's history.

// The open session, hydrated with everything the coach has written about
// this player. Rejects with ApiError 404 when no session is open; the
// query layer maps that to null rather than the banner.
export function GetCoachSession(): Promise<CoachSessionView> {
  return unwrap(sdk.getCoachSession())
}

// End the session and discard the loaned records. Idempotent — closing an
// already-closed session resolves quietly.
export function CloseCoachSession(): Promise<void> {
  return unwrapVoid(sdk.closeCoachSession())
}

// The loaned corpus. These records never touch the coach's database and
// carry no screenshot paths, so nothing resolves against the coach's disk.
export function GetCoachSessionMatches(): Promise<MatchRecord[]> {
  return unwrap(sdk.getCoachSessionMatches())
}

// The bundle suggests a player, the coach confirms (or corrects) one. The
// echoed view carries THAT player's notes, which is how work from an
// earlier session resurfaces.
export function SetCoachSessionPlayer(handle: string): Promise<CoachSessionView> {
  return unwrap(sdk.setCoachSessionPlayer({ body: { handle } }))
}

// The second door onto a session: replay codes rather than a bundle. Each
// code becomes one empty frame the coach fills in as they watch. Rejects
// with 409 while another session is open, exactly as opening a bundle does.
export function OpenCoachReplaySession(codes: string[]): Promise<CoachSessionView> {
  return unwrap(sdk.openCoachReplaySession({ body: { codes } }))
}

// Grow an open replay session's reel. Codes arrive one at a time over voice
// chat, so this is a POST per code; re-adding one already in the reel is a
// no-op returning the unchanged view.
export function AddCoachSessionReplayCode(code: string): Promise<CoachSessionView> {
  return unwrap(sdk.addCoachSessionReplayCode({ body: { code } }))
}

// What the coach observed while watching one replay. Nothing is persisted —
// it rides to the player inside the notes archive.
export function SetCoachSessionMatchContext(
  matchKey: string,
  context: ObservedContext,
): Promise<CoachSessionView> {
  return unwrap(sdk.setCoachSessionMatchContext({ path: { match_key: matchKey }, body: context }))
}

// The note body as the editor holds it. Deliberately looser than the
// generated CoachNoteInput on one field: focus_tags is `string[]` here
// because the room's draft type is, and the vocabulary is validated
// server-side (a tag outside it is a 400, not a compile error). Widening
// once at the boundary keeps the assertion out of the store and the
// editor.
export interface CoachNoteBody {
  kind:        CoachNoteInput['kind']
  text:        string
  focus_tags:  string[]
  extra_tags:  string[]
  match_clock: string
}

// Upsert the coach's one note about one of the session's matches. The
// autosave target: 404 on a key the loaned corpus doesn't carry, 400 when
// the kind rules are violated (a reviewed-only mark carries no content; a
// note must say or tag something).
export function PutCoachNote(matchKey: string, input: CoachNoteBody): Promise<CoachNote> {
  return unwrap(sdk.putCoachNote({
    path: { match_key: matchKey },
    body: input as CoachNoteInput,
  }))
}

// Clear the coach's note about one match. An emptied draft sends THIS, not
// a PUT with empty fields. Idempotent.
export function DeleteCoachNote(matchKey: string): Promise<void> {
  return unwrapVoid(sdk.deleteCoachNote({ path: { match_key: matchKey } }))
}

// One timestamped moment inside a match's note. The moment id is the
// CLIENT's to mint: the autosave queue keys on it from the first keystroke,
// before any round trip has happened. 400 when the clock is not MM:SS, the
// text is empty, or the match already holds the maximum.
export interface CoachMomentBody {
  match_clock: string
  text: string
  // Widened from the generated enum for the same reason CoachNoteBody widens
  // its tag list: the room's draft type is a string, and the vocabulary is
  // validated server-side, so a tag outside it is a 400 rather than a compile
  // error. Widening once at the boundary keeps the cast out of the store.
  focus_tag?: string
}

export function PutCoachMoment(
  matchKey: string, momentID: string, input: CoachMomentBody,
): Promise<CoachMoment> {
  return unwrap(sdk.putCoachMoment({
    path: { match_key: matchKey, moment_id: momentID },
    body: input as CoachMomentInput,
  }))
}

// Drop one moment. The note stays — a match whose last moment was deleted is
// still a match the coach looked at. Idempotent.
export function DeleteCoachMoment(matchKey: string, momentID: string): Promise<void> {
  return unwrapVoid(sdk.deleteCoachMoment({
    path: { match_key: matchKey, moment_id: momentID },
  }))
}

// What this player is being told to work on, in the coach's order. An empty
// array clears the list; `items` is never omitted, so a wipe is deliberate.
export function PutCoachFocusItems(items: FocusItem[]): Promise<void> {
  return unwrapVoid(sdk.putCoachFocusItems({ body: { items } }))
}

/** The player's own list, coach items first. */
export function ListFocus(): Promise<FocusEntry[]> {
  return unwrap(sdk.listFocus())
}

/** Accept (new → working) or retire ("Done with this", → done) one item. */
export function SetFocusItemStatus(itemID: string, status: FocusStatus): Promise<void> {
  return unwrapVoid(sdk.setFocusItemStatus({ path: { item_id: itemID }, body: { status } }))
}

// One of the PLAYER's own timestamped moments on their own match. The moment
// id is the client's to mint, the same as the coach's. 409 when the id already
// names a moment on a different match, or while a coaching session is open.
export function SetMatchMoment(
  matchKey: string, momentID: string, input: CoachMomentBody,
): Promise<CoachMoment> {
  return unwrap(sdk.setMatchMoment({
    path: { match_key: matchKey, moment_id: momentID },
    body: input as MatchMomentInput,
  }))
}

// Drop one of the player's moments. Idempotent.
export function DeleteMatchMoment(matchKey: string, momentID: string): Promise<void> {
  return unwrapVoid(sdk.deleteMatchMoment({
    path: { match_key: matchKey, moment_id: momentID },
  }))
}
