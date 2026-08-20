/**
 * Shared rig for the coaching-session (Film Room) specs.
 *
 * A coach opens a player's exported bundle inside Recall, reviews it in the
 * Film Room, writes notes, exports them; the player imports the notes and
 * accepts each one. Five specs drive that loop and they all need the same
 * corpus + route mocks, so those live here:
 *
 *   - ANONYMOUS_BUNDLE_FIXTURE a PLAIN export, naming nobody: the session
 *                            opens with a blank handle and the note routes
 *                            409 until the coach confirms one
 *   - SESSION_FIXTURE        the player "Sable": six matches over three of
 *                            THEIR local days, one rank screen, one with
 *                            a note of their own. Every `played_at_utc` sits
 *                            9 h off the naive `date`+`finished_at`, so a
 *                            surface that renders the UTC instant in the
 *                            coach's zone (the app's default) shows a
 *                            different clock than the player's — the
 *                            "player-naive time" assertions bite.
 *   - RESURFACED_NOTES       notes the coach wrote in an earlier session
 *                            (a written note + a reviewed-only mark)
 *   - RETURN_SHEET_FIXTURE   the staged notes file the PLAYER imports
 *   - mockCoachSession()     every /coach/session* + /settings/coaching route
 *   - mockInbox()            the player-side /coach/returns routes
 *   - openSessionViaReviewsTab / pinSessionResume / enterFilmRoom / endSession
 *   - identityPrompt / confirmPlayer  the room's "Who is this?" gate
 *   - openCoachRoom()        theme-pinned room for the a11y matrix
 *
 * Reuses seedProfiles / silenceParseEvents / pinTheme / settle* from
 * `_theme-matrix.ts` (which stays untouched — coach cells for the snapshot
 * spec import from HERE).
 *
 * Underscore prefix keeps this file out of Playwright's *.spec.ts glob.
 */
import { expect, type Page, type Route } from '@playwright/test'

import { routeCapture, type RouteCapture } from './_capture'
import {
  daysAgo,
  pinTheme,
  seedProfiles,
  settleLayout,
  settleView,
  silenceParseEvents,
} from './_theme-matrix'

// ── Wire shapes ─────────────────────────────────────────────────────────
//
// The e2e tree imports nothing from src/, so the coach wire shapes are
// restated here. They are the contract the frontend wave builds to.

export type CoachNoteKind = 'note' | 'reviewed_only'

/** One coach-authored note as the session view + PUT body carry it. */
export interface CoachSessionNote {
  note_id: string
  match_key: string
  kind: CoachNoteKind
  text: string
  focus_tags: string[]
  extra_tags: string[]
  match_clock: string
  updated_at: string
}

/** Body of `PUT /api/v1/coach/session/notes/{match_key}` — the note minus identity. */
export type CoachNotePutBody = Pick<CoachSessionNote, 'kind' | 'text' | 'focus_tags' | 'extra_tags' | 'match_clock'>

/** One timestamped moment inside a note. Several share a match. */
export interface CoachSessionMoment {
  moment_id: string
  match_clock: string
  text: string
  focus_tag?: string
  updated_at: string
}

/** Body of `PUT …/notes/{match_key}/moments/{moment_id}`. */
export type CoachMomentPutBody = Pick<CoachSessionMoment, 'match_clock' | 'text' | 'focus_tag'>

/** Zero-pad a single-digit minute, the way the server stores it. */
function padClock(clock: string): string {
  const [m, sec] = clock.split(':')
  return m && m.length === 1 ? `0${m}:${sec}` : clock
}

export interface CoachPlayer {
  id: string
  handle: string
  message: string
}

/** `GET`/`POST /api/v1/coach/session` response. */
export interface CoachSessionView {
  player: CoachPlayer
  exported_at: string
  session_date: string
  match_count: number
  coach_name: string
  focus_items: FocusItemWire[]
  notes: CoachSessionNote[]
  /** True when the bundle named the player, so the handle arrives pre-filled. */
  handle_from_bundle: boolean
}

/** A match as the loaned corpus (`/coach/session/matches`) and `/matches` carry it. */
export interface SessionMatch {
  match_key: string
  source_files: string[]
  source_types: Record<string, string>
  parsed_at: string
  data: Record<string, unknown> & {
    map: string
    game_mode: string
    hero: string
    result: 'victory' | 'defeat' | 'draw'
    date: string
    finished_at: string
    played_at_utc: string
  }
  annotation?: { note?: string; tags?: string[]; replay_code?: string }
  reviewed_by?: 'self' | 'coach'
  coach_notes?: MatchCoachNote[]
}

/** The coach-received layer on a player's match (`MatchRecord.coach_notes[]`). */
export interface MatchCoachNote {
  id: number
  note_id: string
  coach_name: string
  session_date: string
  text: string
  match_clock?: string
  focus_tags: string[]
  extra_tags?: string[]
  accepted_at: string
}

/** One note on the return sheet, with the descriptive snapshot `notes.json` carries. */
export interface CoachReturnNote {
  note_id: string
  match_key: string
  kind: CoachNoteKind
  text: string
  focus_tags: string[]
  extra_tags: string[]
  match_clock: string
  /** The coach's timestamped observations, in reading order. */
  moments?: { moment_id: string; match_clock: string; text: string; focus_tag?: string }[]
  match: { map: string; hero: string; result: string; date: string; finished_at: string }
  /** Server-derived, always present on the wire: pending until the player
      decides, accepted once a block sits on the match, orphan when the
      match is not in this history. The client must see the real shape. */
  status: 'pending' | 'accepted' | 'skipped' | 'orphan'
}

export type CoachDecision = 'accepted' | 'skipped'

/** `GET /api/v1/coach/returns[]` item — a staged notes file plus the player's decisions so far. */
export interface CoachReturnSheet {
  id: number
  coach_name: string
  player_handle: string
  session_date: string
  imported_at: string
  focus_items: FocusItemWire[]
  notes: CoachReturnNote[]
  decisions: Record<string, CoachDecision>
}

/** Body of `PUT /api/v1/coach/returns/{id}/decisions` — partial, keyed by note_id. */
export interface CoachDecisionsBody {
  decisions: Record<string, CoachDecision>
}

export interface SessionFixture {
  player: CoachPlayer
  exported_at: string
  matches: SessionMatch[]
}

// ── Fixtures ────────────────────────────────────────────────────────────

/** localStorage flag the store reads to decide whether to ask the server for a session on boot. */
export const COACH_SESSION_RESUME_KEY = 'recall.coach.sessionOpen'

export const COACH_NAME = 'Ordo'

/** Empty ZIP (bare end-of-central-directory) — the mocks never read the bytes. */
export const FAKE_ZIP = Buffer.from([
  0x50, 0x4b, 0x05, 0x06,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
])

const PLAYER_ZONE_OFFSET_HOURS = 9

/**
 * The player's canonical UTC instant, deliberately 9 h away from their naive
 * clock (they play at UTC−9). A coach anywhere else sees a different HH:MM
 * — and often a different DAY — if a surface renders the instant instead
 * of the naive fields.
 */
function playedAtUTC(date: string, time: string): string {
  const naiveAsUTC = new Date(`${date}T${time}:00Z`)
  naiveAsUTC.setUTCHours(naiveAsUTC.getUTCHours() + PLAYER_ZONE_OFFSET_HOURS)
  return naiveAsUTC.toISOString()
}

interface MatchSpec {
  map: string
  mode: string
  hero: string
  role: 'tank' | 'dps' | 'support'
  result: 'victory' | 'defeat' | 'draw'
  dayOffset: number
  time: string
  score: string
  ead: [number, number, number]
  healing: number
  /** MM:SS. Defaults to 11:40 — the strip needs a duration to scale against. */
  gameLength?: string
}

function sessionMatch(spec: MatchSpec): SessionMatch {
  const date = daysAgo(spec.dayOffset)
  const [hh, mm] = spec.time.split(':')
  const key = `match-${date}T${hh}-${mm}-00`
  const [eliminations, assists, deaths] = spec.ead
  return {
    match_key: key,
    source_files: [`${key}.png`],
    source_types: { [`${key}.png`]: 'summary' },
    parsed_at: playedAtUTC(date, spec.time),
    data: {
      map: spec.map,
      game_mode: spec.mode,
      hero: spec.hero,
      role: spec.role,
      result: spec.result,
      final_score: spec.score,
      date,
      finished_at: spec.time,
      played_at_utc: playedAtUTC(date, spec.time),
      playlist: 'competitive',
      eliminations,
      assists,
      deaths,
      healing: spec.healing,
      // The cue strip reads this: a moment at 4:45 of a 9:12 match sits about
      // halfway down the rail, and a stamp past the end is a typo worth
      // warning about.
      game_length: spec.gameLength ?? '11:40',
      heroes_played: [{ hero: spec.hero, play_time: '11:40', percent_played: 100 }],
    },
  }
}

/** Add the RANK PROGRESS screenshot + its fields to a summary-only match. */
function withRankScreen(match: SessionMatch): SessionMatch {
  const rankFile = `${match.match_key}-rank.png`
  return {
    ...match,
    source_files: [...match.source_files, rankFile],
    source_types: { ...match.source_types, [rankFile]: 'rank' },
    data: { ...match.data, rank: 'diamond', level: 3, rank_progress: 62, change_percent: 8, modifiers: ['expected'] },
  }
}

const SABLE_ID = '4c1c8f6e-2d3a-4b7e-9f10-6a5d2c8e1b47'

// Newest first, the way the reel + the Matches list order them. Day A
// (2 days back) holds three, day B (3 back) two — one of them the rank
// screen — and day C (5 back) one. Sable's own note sits on the newest.

/** The match Sable wrote their own note on — the newest, so the first frame in the reel. */
export const NOTED_MATCH: SessionMatch = {
  ...sessionMatch({ map: 'numbani', mode: 'hybrid', hero: 'ana', role: 'support', result: 'victory', dayOffset: 2, time: '22:30', score: '4-3', ead: [12, 19, 5], healing: 10230 }),
  annotation: {
    note: 'Kept peeling too late for the tank on point B — pre-position on the high ground before the fight.',
    tags: ['stack'],
  },
}
/** The King's Row match — the reel/desk clock assertions read its naive time. */
export const KINGS_ROW_MATCH: SessionMatch = {
  ...sessionMatch({ map: "king's row", mode: 'hybrid', hero: 'ana', role: 'support', result: 'victory', dayOffset: 2, time: '21:14', score: '3-2', ead: [14, 21, 4], healing: 9840 }),
  // A replay code, because a moment the reader cannot get to is trivia — the
  // strip prints this beside every one.
  annotation: { replay_code: 'RPL45X' },
}
/** The Lijiang Tower match, which carries the rank screen. */
export const RANK_MATCH: SessionMatch = withRankScreen(
  sessionMatch({ map: 'lijiang tower', mode: 'control', hero: 'juno', role: 'support', result: 'victory', dayOffset: 3, time: '20:05', score: '2-0', ead: [10, 22, 3], healing: 8880 }),
)
/** The oldest match (Midtown) — reviewed-only in the resurfaced + return fixtures. */
export const OLDEST_MATCH: SessionMatch =
  sessionMatch({ map: 'midtown', mode: 'hybrid', hero: 'lucio', role: 'support', result: 'defeat', dayOffset: 5, time: '19:31', score: '2-3', ead: [13, 12, 8], healing: 5940 })

const SABLE_MATCHES: SessionMatch[] = [
  NOTED_MATCH,
  sessionMatch({ map: 'busan', mode: 'control', hero: 'kiriko', role: 'support', result: 'defeat', dayOffset: 2, time: '21:52', score: '1-2', ead: [9, 15, 7], healing: 7120 }),
  KINGS_ROW_MATCH,
  sessionMatch({ map: 'colosseo', mode: 'push', hero: 'brigitte', role: 'support', result: 'defeat', dayOffset: 3, time: '20:47', score: '0-1', ead: [11, 13, 6], healing: 6210 }),
  RANK_MATCH,
  OLDEST_MATCH,
]

/** The player whose bundle the coach opens: "Sable", six matches, one message. */
export const SESSION_FIXTURE: SessionFixture = {
  player: {
    id: SABLE_ID,
    handle: 'Sable',
    message: 'Mostly worried about my ult timing on control — tell me if I am wrong.',
  },
  exported_at: `${daysAgo(1)}T18:30:00Z`,
  matches: SABLE_MATCHES,
}

/** A second player with no notes — the stale-draft leak hunt opens this after Sable. */
export const OTHER_PLAYER_FIXTURE: SessionFixture = {
  player: { id: '9e7b2a10-5f4c-4d6e-8a21-3b0c7d9e4f52', handle: 'Wren', message: '' },
  exported_at: `${daysAgo(1)}T20:05:00Z`,
  matches: [
    sessionMatch({ map: 'rialto', mode: 'escort', hero: 'dva', role: 'tank', result: 'defeat', dayOffset: 4, time: '23:02', score: '2-3', ead: [18, 6, 9], healing: 0 }),
    sessionMatch({ map: 'oasis', mode: 'control', hero: 'winston', role: 'tank', result: 'victory', dayOffset: 4, time: '22:21', score: '2-1', ead: [21, 8, 5], healing: 0 }),
  ],
}

/**
 * A plain (not "share with a coach") export: the manifest names nobody, so
 * the session opens with a blank handle and every note PUT answers 409
 * until the coach confirms one. Every other fixture here hardcodes "Sable",
 * which is exactly why the blank-handle dead end went unnoticed.
 */
export const ANONYMOUS_BUNDLE_FIXTURE: SessionFixture = {
  player: { id: '', handle: '', message: '' },
  exported_at: `${daysAgo(1)}T21:40:00Z`,
  matches: [
    sessionMatch({ map: 'suravasa', mode: 'flashpoint', hero: 'mercy', role: 'support', result: 'victory', dayOffset: 3, time: '22:14', score: '3-2', ead: [7, 24, 4], healing: 11400 }),
    sessionMatch({ map: 'esperanca', mode: 'push', hero: 'baptiste', role: 'support', result: 'defeat', dayOffset: 3, time: '21:35', score: '1-2', ead: [12, 17, 6], healing: 9120 }),
  ],
}

/** The coach's OWN two matches — what `/matches` shows outside a session. */
export const COACH_OWN_MATCHES: SessionMatch[] = [
  sessionMatch({ map: 'dorado', mode: 'escort', hero: 'cassidy', role: 'dps', result: 'victory', dayOffset: 6, time: '20:10', score: '3-2', ead: [24, 5, 7], healing: 0 }),
  sessionMatch({ map: 'ilios', mode: 'control', hero: 'tracer', role: 'dps', result: 'defeat', dayOffset: 7, time: '21:44', score: '1-2', ead: [19, 3, 11], healing: 0 }),
]

/** Notes the coach wrote about Sable in an earlier session — hydrated on open/resume. */
export const RESURFACED_NOTES: CoachSessionNote[] = [
  {
    note_id: 'a3f1c2d4-8e9b-4a7c-b6d5-1f2e3d4c5b6a',
    match_key: NOTED_MATCH.match_key,
    kind: 'note',
    text: "Late peel on B — watch the tank's cooldowns before you commit.",
    focus_tags: ['positioning', 'cooldowns'],
    extra_tags: [],
    match_clock: '06:40',
    updated_at: `${daysAgo(1)}T19:02:00Z`,
  },
  {
    note_id: 'b7e2d3c4-9f0a-4b8d-8c1e-2a3b4c5d6e7f',
    match_key: OLDEST_MATCH.match_key,
    kind: 'reviewed_only',
    text: '',
    focus_tags: [],
    extra_tags: [],
    match_clock: '',
    updated_at: `${daysAgo(1)}T19:04:00Z`,
  },
]

/** One line of "what to work on", as it travels on the wire. */
export interface FocusItemWire {
  item_id: string
  text: string
  status?: 'new' | 'working' | 'done'
}

export const RESURFACED_ITEM_ID = 'e1f2a3b4-5c6d-4e7f-8a9b-0c1d2e3f4a5b'
export const RESURFACED_SUMMARY = 'Ult economy first, positioning second. Watch three of your own control losses back.'

/** The notes file Ordo sent back — three notes on Sable's own matches, no decisions yet. */
export const RETURN_SHEET_FIXTURE: CoachReturnSheet = {
  id: 7,
  coach_name: COACH_NAME,
  player_handle: 'Sable',
  session_date: daysAgo(1),
  imported_at: `${daysAgo(0)}T09:12:00Z`,
  focus_items: [{ item_id: RESURFACED_ITEM_ID, text: RESURFACED_SUMMARY }],
  notes: [
    {
      note_id: 'c1d2e3f4-0a1b-4c2d-9e3f-4a5b6c7d8e9f',
      match_key: NOTED_MATCH.match_key,
      kind: 'note',
      text: 'Late peel on B — you commit before the tank has cooldowns back. Hold high ground until the second bubble.',
      focus_tags: ['positioning', 'ult economy'],
      extra_tags: ['tempo'],
      match_clock: '06:40',
      match: { map: NOTED_MATCH.data.map, hero: NOTED_MATCH.data.hero, result: NOTED_MATCH.data.result, date: NOTED_MATCH.data.date, finished_at: NOTED_MATCH.data.finished_at },
      status: 'pending',
    },
    {
      note_id: 'd2e3f4a5-1b2c-4d3e-8f4a-5b6c7d8e9f0a',
      match_key: OLDEST_MATCH.match_key,
      kind: 'reviewed_only',
      text: '',
      focus_tags: [],
      extra_tags: [],
      match_clock: '',
      match: { map: OLDEST_MATCH.data.map, hero: OLDEST_MATCH.data.hero, result: OLDEST_MATCH.data.result, date: OLDEST_MATCH.data.date, finished_at: OLDEST_MATCH.data.finished_at },
      status: 'pending',
    },
    {
      note_id: 'e3f4a5b6-2c3d-4e4f-9a5b-6c7d8e9f0a1b',
      match_key: KINGS_ROW_MATCH.match_key,
      kind: 'note',
      text: "Good early ult on King's Row — that is the tempo I want everywhere.",
      focus_tags: [],
      extra_tags: [],
      match_clock: '',
      moments: [
        { moment_id: 'mo-1', match_clock: '03:23', text: 'No off-angle — the tank ate the pressure alone.', focus_tag: 'positioning' },
        { moment_id: 'mo-2', match_clock: '04:13', text: 'No ult tracking.', focus_tag: 'ult_economy' },
        { moment_id: 'mo-3', match_clock: '04:45', text: 'Cassidy flanked behind you.' },
      ],
      match: { map: KINGS_ROW_MATCH.data.map, hero: KINGS_ROW_MATCH.data.hero, result: KINGS_ROW_MATCH.data.result, date: KINGS_ROW_MATCH.data.date, finished_at: KINGS_ROW_MATCH.data.finished_at },
      status: 'pending',
    },
  ],
  decisions: {},
}

// ── Route helpers ───────────────────────────────────────────────────────

async function fulfillJSON(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function fulfillProblem(route: Route, status: number, detail: string): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/problem+json',
    body: JSON.stringify({ type: 'about:blank', title: detail, status, detail }),
  })
}

function lastPathSegment(route: Route): string {
  const segments = new URL(route.request().url()).pathname.split('/')
  return decodeURIComponent(segments[segments.length - 1] ?? '')
}

function parseBody<T>(route: Route): T {
  return JSON.parse(route.request().postData() ?? '{}') as T
}

/** Serve `matches` for `GET /api/v1/matches`; every other method falls through. */
export async function seedMatchList(page: Page, matches: () => SessionMatch[]): Promise<void> {
  await page.route('**/api/v1/matches', async (route: Route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback()
      return
    }
    await fulfillJSON(route, matches())
  })
}

/** The coach's own two matches — the list every spec should see OUTSIDE a session. */
export async function seedCoachOwnMatches(page: Page): Promise<void> {
  await seedMatchList(page, () => COACH_OWN_MATCHES)
}

/** Sable's matches as the PLAYER's own history — the return-sheet side. */
export async function seedPlayerHistory(page: Page): Promise<void> {
  await seedMatchList(page, () => SESSION_FIXTURE.matches)
}

// ── Coach session mock ──────────────────────────────────────────────────

export interface CoachSessionMockOptions {
  /** Notes hydrated into the view on open/resume (default: none). */
  notes?: CoachSessionNote[]
  /** The bundle the next `POST /coach/session` "opens" (default: Sable). */
  session?: SessionFixture
  /** `GET /settings/coaching` + the view's `coach_name` (default "Ordo"; '' = unset). */
  coachName?: string
  /** Start with the session already open — pair with pinSessionResume(). */
  active?: boolean
  focusItems?: FocusItemWire[]
}

export interface CoachSessionMock {
  /** Last `PUT /coach/session/notes/{match_key}` body. */
  notePut: RouteCapture<CoachNotePutBody>
  /** Match key of the last note PUT. */
  notePutKey: RouteCapture<string>
  /** Match keys the room sent a DELETE for, in order. */
  noteDeletes: string[]
  /** Last `PUT …/moments/{moment_id}` body. */
  momentPut: RouteCapture<CoachMomentPutBody>
  /** Match key of the last moment PUT. */
  momentPutKey: RouteCapture<string>
  /** Moment ids the room sent a DELETE for, in order. */
  momentDeletes: string[]
  /** Last `PUT /coach/session/focus-items` body. */
  focusPut: RouteCapture<{ items: FocusItemWire[] }>
  /** Last `PUT /settings/coaching` body. */
  coachNamePut: RouteCapture<{ coach_name: string }>
  isActive: () => boolean
  openCount: () => number
  exportCount: () => number
  /** Notes as the server currently holds them (PUT/DELETE applied). */
  notes: () => CoachSessionNote[]
  /** Swap the bundle the NEXT open returns — the "open a different player" hunt. */
  swapPlayer: (session: SessionFixture, notes?: CoachSessionNote[]) => void
}

interface SessionState {
  session: SessionFixture
  notes: Map<string, CoachSessionNote>
  /** Moments per match key — several share a match, which is the point. */
  moments: Map<string, CoachSessionMoment[]>
  focusItems: FocusItemWire[]
  coachName: string
  active: boolean
  handleFromBundle: boolean
  opens: number
  exports: number
}

function viewOf(state: SessionState): CoachSessionView {
  return {
    player: state.session.player,
    exported_at: state.session.exported_at,
    session_date: daysAgo(0),
    match_count: state.session.matches.length,
    coach_name: state.coachName,
    focus_items: state.focusItems,
    notes: [...state.notes.values()],
    handle_from_bundle: state.handleFromBundle,
  }
}

function noteMap(notes: CoachSessionNote[]): Map<string, CoachSessionNote> {
  return new Map(notes.map((n) => [n.match_key, n]))
}

async function routeSessionResource(page: Page, state: SessionState): Promise<void> {
  await page.route('**/api/v1/coach/session', async (route: Route) => {
    const method = route.request().method()
    if (method === 'POST') {
      state.active = true
      state.opens += 1
      await fulfillJSON(route, viewOf(state), 201)
      return
    }
    if (method === 'DELETE') {
      state.active = false
      await route.fulfill({ status: 204, body: '' })
      return
    }
    if (!state.active) {
      await fulfillProblem(route, 404, 'no coaching session is open')
      return
    }
    await fulfillJSON(route, viewOf(state))
  })
  await page.route('**/api/v1/coach/session/matches', async (route: Route) => {
    if (!state.active) {
      await fulfillProblem(route, 404, 'no coaching session is open')
      return
    }
    await fulfillJSON(route, state.session.matches)
  })
  await page.route('**/api/v1/coach/session/player', async (route: Route) => {
    const body = parseBody<{ handle?: string }>(route)
    state.session = { ...state.session, player: { ...state.session.player, handle: body.handle ?? state.session.player.handle } }
    await fulfillJSON(route, viewOf(state))
  })
}

async function routeSessionNotes(page: Page, state: SessionState, mock: CoachSessionMock): Promise<void> {
  await page.route('**/api/v1/coach/session/notes/*', async (route: Route) => {
    // The server keys notes on the player, so there is nowhere to put one
    // until a handle is confirmed. Mirroring that 409 here is what makes
    // "the room asks first" testable rather than cosmetic.
    if (state.session.player.handle === '') {
      await fulfillProblem(route, 409, 'confirm the player before writing notes')
      return
    }
    const key = lastPathSegment(route)
    if (route.request().method() === 'DELETE') {
      state.notes.delete(key)
      mock.noteDeletes.push(key)
      await route.fulfill({ status: 204, body: '' })
      return
    }
    const body = parseBody<CoachNotePutBody>(route)
    const existing = state.notes.get(key)
    const saved: CoachSessionNote = {
      note_id: existing?.note_id ?? `mock-note-${state.notes.size + 1}`,
      match_key: key,
      ...body,
      updated_at: new Date().toISOString(),
    }
    state.notes.set(key, saved)
    mock.notePut.set(body)
    mock.notePutKey.set(key)
    await fulfillJSON(route, saved)
  })
  // Registered BEFORE the focus-items route and AFTER the notes one. The notes
  // glob is `notes/*`, and Playwright's `*` stops at a slash, so it does not
  // reach `notes/<key>/moments/<id>` — but the ordering is stated here anyway,
  // because a future `notes/**` would silently swallow every moment write.
  await page.route('**/api/v1/coach/session/notes/*/moments/*', async (route: Route) => {
    if (state.session.player.handle === '') {
      await fulfillProblem(route, 409, 'confirm the player before writing notes')
      return
    }
    const parts = new URL(route.request().url()).pathname.split('/')
    const momentID = parts[parts.length - 1] ?? ''
    const matchKey = parts[parts.length - 3] ?? ''
    const bucket = state.moments.get(matchKey) ?? []
    if (route.request().method() === 'DELETE') {
      state.moments.set(matchKey, bucket.filter((m) => m.moment_id !== momentID))
      mock.momentDeletes.push(momentID)
      await route.fulfill({ status: 204, body: '' })
      return
    }
    const body = parseBody<CoachMomentPutBody>(route)
    // The server refuses what it cannot read rather than storing it; the mock
    // has to as well, or the spec proving the refusal passes against a client
    // that never validated.
    if (!/^\d{1,2}:[0-5]\d$/.test(body.match_clock.trim())) {
      await fulfillProblem(route, 400, `match clock ${body.match_clock} is not MM:SS`)
      return
    }
    const saved: CoachSessionMoment = {
      moment_id: momentID,
      match_clock: padClock(body.match_clock.trim()),
      text: body.text,
      ...(body.focus_tag ? { focus_tag: body.focus_tag } : {}),
      updated_at: new Date().toISOString(),
    }
    state.moments.set(matchKey, [...bucket.filter((m) => m.moment_id !== momentID), saved])
    mock.momentPut.set(body)
    mock.momentPutKey.set(matchKey)
    await fulfillJSON(route, saved)
  })
  await page.route('**/api/v1/coach/session/focus-items', async (route: Route) => {
    // Same 409 the note route mirrors, and for the same reason: the server
    // keys the list on the player too (PutCoachFocusItems →
    // sessionPlayerLocked). This mock used to answer 204 here, which is
    // precisely why the harness built to prove "the room asks first" could
    // not see that the box accepted typing the server would refuse.
    if (state.session.player.handle === '') {
      await fulfillProblem(route, 409, 'confirm the player before writing a focus list')
      return
    }
    const body = parseBody<{ items: FocusItemWire[] }>(route)
    state.focusItems = body.items
    mock.focusPut.set(body)
    await route.fulfill({ status: 204, body: '' })
  })
}

async function routeSessionExport(page: Page, state: SessionState): Promise<void> {
  await page.route('**/api/v1/coach/session/export', async (route: Route) => {
    state.exports += 1
    const handle = state.session.player.handle.toLowerCase()
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="recall-coach-notes-${handle}-${daysAgo(0)}.zip"`,
      },
      body: FAKE_ZIP,
    })
  })
}

async function routeCoachingSettings(page: Page, state: SessionState, mock: CoachSessionMock): Promise<void> {
  await page.route('**/api/v1/settings/coaching', async (route: Route) => {
    if (route.request().method() === 'PUT') {
      const body = parseBody<{ coach_name: string }>(route)
      state.coachName = body.coach_name
      mock.coachNamePut.set(body)
    }
    await fulfillJSON(route, { coach_name: state.coachName })
  })
}

/**
 * Mock every coach-session route: open/read/close, the loaned matches,
 * note + summary autosave, export, and the coach-name setting. State
 * lives in the test process, so it survives `page.reload()` — which is
 * exactly what the resume hunt needs.
 */
export async function mockCoachSession(page: Page, opts: CoachSessionMockOptions = {}): Promise<CoachSessionMock> {
  const opened = opts.session ?? SESSION_FIXTURE
  const state: SessionState = {
    session: opened,
    notes: noteMap(opts.notes ?? []),
    moments: new Map(),
    focusItems: opts.focusItems ?? [],
    coachName: opts.coachName ?? COACH_NAME,
    active: opts.active ?? false,
    handleFromBundle: opened.player.handle !== '',
    opens: 0,
    exports: 0,
  }
  const mock: CoachSessionMock = {
    notePut: routeCapture<CoachNotePutBody>('coach note PUT body'),
    notePutKey: routeCapture<string>('coach note PUT match key'),
    noteDeletes: [],
    momentPut: routeCapture<CoachMomentPutBody>('coach moment PUT body'),
    momentPutKey: routeCapture<string>('coach moment PUT match key'),
    momentDeletes: [],
    focusPut: routeCapture<{ items: FocusItemWire[] }>('coach focus list PUT body'),
    coachNamePut: routeCapture<{ coach_name: string }>('coaching settings PUT body'),
    isActive: () => state.active,
    openCount: () => state.opens,
    exportCount: () => state.exports,
    notes: () => [...state.notes.values()],
    swapPlayer: (session, notes = []) => {
      state.session = session
      state.notes = noteMap(notes)
      state.focusItems = []
      state.handleFromBundle = session.player.handle !== ''
    },
  }
  await routeSessionResource(page, state)
  await routeSessionNotes(page, state, mock)
  await routeSessionExport(page, state)
  await routeCoachingSettings(page, state, mock)
  return mock
}

// ── Player-side inbox mock ──────────────────────────────────────────────

export interface InboxMock {
  /** Last `PUT /coach/returns/{id}/decisions` body. */
  decisionsPut: RouteCapture<CoachDecisionsBody>
  putCount: () => number
  /** Sheet ids the player deleted, in order. */
  deletedIds: number[]
}

/**
 * Mock the player's return-sheet inbox over a LIVE array: the import mock
 * pushes a sheet in, decisions merge into it, and GET always reflects the
 * current state — so "pending" (undecided notes) evolves the way the real
 * server's would.
 */
export async function mockInbox(page: Page, sheets: CoachReturnSheet[]): Promise<InboxMock> {
  let puts = 0
  const mock: InboxMock = {
    decisionsPut: routeCapture<CoachDecisionsBody>('return-sheet decisions PUT body'),
    putCount: () => puts,
    deletedIds: [],
  }
  await page.route('**/api/v1/coach/returns', async (route: Route) => {
    await fulfillJSON(route, sheets)
  })
  await page.route('**/api/v1/coach/returns/*/decisions', async (route: Route) => {
    const id = Number(new URL(route.request().url()).pathname.split('/').at(-2))
    const body = parseBody<CoachDecisionsBody>(route)
    const sheet = sheets.find((s) => s.id === id)
    if (sheet) sheet.decisions = { ...sheet.decisions, ...body.decisions }
    puts += 1
    mock.decisionsPut.set(body)
    await route.fulfill({ status: 204, body: '' })
  })
  await page.route('**/api/v1/coach/returns/*', async (route: Route) => {
    if (route.request().method() !== 'DELETE') {
      await route.fallback()
      return
    }
    const id = Number(lastPathSegment(route))
    mock.deletedIds.push(id)
    const at = sheets.findIndex((s) => s.id === id)
    if (at >= 0) sheets.splice(at, 1)
    await route.fulfill({ status: 204, body: '' })
  })
  return mock
}

// ── Player-side matches with the accepted coach layer ───────────────────

export interface CoachNotesMatchesMock {
  /** Last `DELETE /matches/{match_key}/coach-notes/{id}` seen. */
  deleted: RouteCapture<{ matchKey: string; noteId: number }>
}

function acceptedLayer(sheet: CoachReturnSheet): Map<string, MatchCoachNote> {
  const layer = new Map<string, MatchCoachNote>()
  sheet.notes
    .filter((n) => n.kind === 'note')
    .forEach((n, i) => {
      layer.set(n.match_key, {
        id: i + 1,
        note_id: n.note_id,
        coach_name: sheet.coach_name,
        session_date: sheet.session_date,
        text: n.text,
        match_clock: n.match_clock,
        focus_tags: n.focus_tags,
        extra_tags: n.extra_tags,
        // The moments travel onto the block with the note — the half of a
        // timestamped review that points at something.
        ...(n.moments?.length ? { moments: n.moments } : {}),
        accepted_at: `${daysAgo(0)}T09:15:00Z`,
      })
    })
  return layer
}

/**
 * Serve Sable's history AFTER they accepted every note on
 * RETURN_SHEET_FIXTURE: each written note is a `coach_notes[]` block on its
 * match, and every decided match carries `reviewed_by: 'coach'`. The
 * "Remove this note" DELETE drops the block, so the next GET omits it.
 */
export async function mockMatchesWithCoachNotes(page: Page): Promise<CoachNotesMatchesMock> {
  const layer = acceptedLayer(RETURN_SHEET_FIXTURE)
  const reviewed = new Set(RETURN_SHEET_FIXTURE.notes.map((n) => n.match_key))
  const mock: CoachNotesMatchesMock = {
    deleted: routeCapture<{ matchKey: string; noteId: number }>('coach-note DELETE'),
  }
  await seedMatchList(page, () =>
    SESSION_FIXTURE.matches.map((m) => {
      const block = layer.get(m.match_key)
      return {
        ...m,
        ...(reviewed.has(m.match_key) ? { reviewed_by: 'coach' as const } : {}),
        ...(block ? { coach_notes: [block] } : {}),
      }
    }),
  )
  await page.route('**/api/v1/matches/*/coach-notes/*', async (route: Route) => {
    const segments = new URL(route.request().url()).pathname.split('/')
    const matchKey = decodeURIComponent(segments.at(-3) ?? '')
    const noteId = Number(segments.at(-1))
    mock.deleted.set({ matchKey, noteId })
    layer.delete(matchKey)
    await route.fulfill({ status: 204, body: '' })
  })
  return mock
}

// ── Page drivers ────────────────────────────────────────────────────────

/** Flag the resume key before first paint, so the store asks the server for the open session on boot. */
export async function pinSessionResume(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    try { localStorage.setItem(key, 'true') } catch (_) { /* sandboxed context */ }
  }, COACH_SESSION_RESUME_KEY)
}

/** The masthead loan slip — present exactly while a session is open. */
export function loanSlip(page: Page, handle = 'Sable') {
  return page.getByRole('region', { name: new RegExp(`Coaching session: reviewing ${handle}`) })
}

/** The "← Back to the film room" affordance shown on every tab while in a session. */
export function backToFilmRoom(page: Page) {
  return page.getByRole('button', { name: /Back to the film room/ })
}

/** The Film Room — a region inside the Reviews tab's panel while a session is open. */
export function filmRoom(page: Page) {
  return page.locator('#film-room')
}

/**
 * Open a session the way a coach does: the Reviews tab → "Open a player's
 * bundle…" → file chooser. The bytes are a stub; the mocked POST answers.
 * (It used to be a profile-menu item; the entry moved to the tab that is
 * coaching's home.)
 */
export async function openSessionViaReviewsTab(page: Page): Promise<void> {
  await page.getByRole('tab', { name: /^Reviews/ }).click()
  const item = page.getByRole('button', { name: /Open a player.s bundle/ })
  // Assert first, so a missing button is the failure — not a dangling
  // file-chooser wait that only times out after it.
  await expect(item).toBeVisible()
  const chooser = page.waitForEvent('filechooser')
  await item.click()
  await (await chooser).setFiles({ name: 'sable-bundle.zip', mimeType: 'application/zip', buffer: FAKE_ZIP })
}

/** The room's "Who is this?" prompt — present until a handle is confirmed. */
export function identityPrompt(page: Page) {
  return page.getByRole('region', { name: 'Who is this?' })
}

/** Answer the room's "Who is this?" prompt. */
export async function confirmPlayer(page: Page, handle: string): Promise<void> {
  await identityPrompt(page).getByRole('textbox', { name: 'Player handle' }).fill(handle)
  await identityPrompt(page).getByRole('button', { name: 'Confirm' }).click()
}

/**
 * Land in the Film Room from wherever the app is: already there (a fresh
 * open, and now a resume too), or on a tab with the back affordance.
 *
 * Deliberately tolerant of both, because it is used by specs that care about
 * what happens IN the room rather than how they got there. That tolerance is
 * also why the resume landing needs its own case in
 * coach-session-open-end.spec.ts — this helper clicks the way in, so it
 * passes either way.
 */
export async function enterFilmRoom(page: Page): Promise<void> {
  await expect(filmRoom(page).or(backToFilmRoom(page))).toBeVisible()
  if (!(await filmRoom(page).isVisible())) await backToFilmRoom(page).click()
  await expect(filmRoom(page)).toBeVisible()
}

/**
 * End the session from the slip. When the room holds unexported work the
 * button asks once more; a clean session ends on the first click.
 */
export async function endSession(page: Page, handle = 'Sable'): Promise<void> {
  await loanSlip(page, handle).getByRole('button', { name: '2 · End session' }).click()
  const confirm = page.getByRole('button', { name: /^End anyway/ })
  await expect(confirm.or(page.locator('.profile-chip'))).toBeVisible()
  if (await confirm.isVisible()) await confirm.click()
  await expect(loanSlip(page, handle)).toHaveCount(0)
}

/**
 * Theme-pinned, layout-settled Film Room for the a11y matrix: Sable's
 * bundle open with the resurfaced notes, entered via resume.
 */
export async function openCoachRoom(page: Page, theme: string): Promise<void> {
  await pinTheme(page, theme)
  await silenceParseEvents(page)
  await seedProfiles(page)
  await seedCoachOwnMatches(page)
  await mockCoachSession(page, {
    notes: RESURFACED_NOTES,
    focusItems: [{ item_id: RESURFACED_ITEM_ID, text: RESURFACED_SUMMARY }],
    active: true,
  })
  await pinSessionResume(page)
  await page.goto('/')
  await enterFilmRoom(page)
  // The room is inside the Reviews tab's panel, so that is the panel to
  // settle — the room region is a child of it.
  await settleView(page, 'tab-reviews')
  await settleLayout(page)
}
