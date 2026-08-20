/**
 * Self-review mocks — the player's saved sittings over their OWN matches.
 *
 * A live in-memory server behind `/api/v1/self-reviews…`: create / list /
 * get / update / delete a sitting, replace its set, write and delete notes
 * and moments, finish. Every write mutates one state so a GET after a PUT
 * reads what was written — the way the real server behaves — and the
 * matches list is served WITH the blocks the sittings put on each match
 * (`self_review_notes[]`), so the journal and the desk see them.
 *
 * The e2e tree imports nothing from src/, so the wire shapes are restated
 * here — a drift shows up as a failing spec, which is the point.
 */
import { type Page, type Route } from '@playwright/test'

import { routeCapture, type RouteCapture } from './_capture'
import { SESSION_FIXTURE, type FocusItemWire, type SessionMatch } from './_coach'

export interface SelfReviewNoteWire {
  match_key: string
  kind: 'note' | 'reviewed_only'
  text: string
  focus_tags: string[]
  extra_tags: string[]
  match_clock: string
  moments?: { moment_id: string; match_clock: string; text: string; focus_tag?: string }[]
  created_at: string
  updated_at: string
}

export interface SelfReviewWire {
  review_id: string
  title: string
  focus_items: FocusItemWire[]
  created_at: string
  updated_at: string
  finished_at?: string
  match_keys: string[]
  notes: Record<string, SelfReviewNoteWire>
}

/** What `MatchRecord.self_review_notes[]` carries. */
export interface MatchSelfReviewNote {
  review_id: string
  review_title?: string
  review_created_at: string
  review_finished_at?: string
  kind: 'note' | 'reviewed_only'
  text: string
  match_clock?: string
  focus_tags?: string[]
  extra_tags?: string[]
  moments?: { moment_id: string; match_clock: string; text: string; focus_tag?: string }[]
  updated_at: string
}

export interface SelfReviewNotePutBody {
  kind: string
  text: string
  focus_tags: string[]
  extra_tags: string[]
  match_clock: string
}

export interface SelfReviewMomentPutBody {
  match_clock: string
  text: string
  focus_tag?: string
}

export interface SelfReviewsMock {
  /** Last `POST /self-reviews` body. */
  created: RouteCapture<{ title?: string; match_keys: string[] }>
  /** Last note PUT body and its (review, match) address. */
  notePut: RouteCapture<SelfReviewNotePutBody>
  notePutKey: RouteCapture<string>
  /** Last moment PUT body and its moment id. */
  momentPut: RouteCapture<SelfReviewMomentPutBody>
  momentPutId: RouteCapture<string>
  /** Last `PUT /self-reviews/{id}` body. */
  updatePut: RouteCapture<{ title: string }>
  /** Last `PUT /self-reviews/{id}/focus-items` body. */
  focusPut: RouteCapture<{ items: FocusItemWire[] }>
  /** Review ids finished, in order. */
  finished: string[]
  /** Review ids deleted, in order. */
  deleted: string[]
  /** Every sitting the mock currently holds. */
  reviews: () => SelfReviewWire[]
}

export interface SelfReviewsMockOptions {
  /** Sittings present before the page loads. */
  reviews?: SelfReviewWire[]
  /** The player's own matches served by GET /matches (default: Sable's fixture). */
  matches?: SessionMatch[]
}

const A_MINUTE = 60_000

/** A deterministic sitting id — the mock mints these; a spec pins them. */
export const SITTING_ID = 'aaaaaaaa-1111-4222-8333-444444444444'
export const OTHER_SITTING_ID = 'bbbbbbbb-1111-4222-8333-444444444444'

function nowIso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** A finished sitting over the two newest fixture matches, with one note. */
export function finishedSitting(over: Partial<SelfReviewWire> = {}): SelfReviewWire {
  const [first, second] = SESSION_FIXTURE.matches
  const created = nowIso(-3 * 24 * 60 * A_MINUTE)
  return {
    review_id: SITTING_ID,
    title: "Tuesday's Ana games",
    focus_items: [{ item_id: 'a1b2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d', text: 'Stop chasing flanks; hold the high ground and let them come.', status: 'working' }],
    created_at: created,
    updated_at: created,
    finished_at: nowIso(-3 * 24 * 60 * A_MINUTE + 40 * A_MINUTE),
    match_keys: [first!.match_key, second!.match_key],
    notes: {
      [first!.match_key]: {
        match_key: first!.match_key, kind: 'note', text: 'Held the choke, then chased.',
        focus_tags: ['positioning'], extra_tags: [], match_clock: '',
        moments: [{ moment_id: 'sr-m1', match_clock: '04:45', text: 'peeled late', focus_tag: 'cooldowns' }],
        created_at: created, updated_at: created,
      },
    },
    ...over,
  }
}

function fulfillJSON(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

function fulfillProblem(route: Route, status: number, detail: string): Promise<void> {
  return route.fulfill({
    status, contentType: 'application/problem+json',
    body: JSON.stringify({ type: 'about:blank', title: detail, status, detail }),
  })
}

function parseBody<T>(route: Route): T {
  return JSON.parse(route.request().postData() ?? '{}') as T
}

/** Path segments after `/api/v1/self-reviews`. */
function segments(route: Route): string[] {
  const path = new URL(route.request().url()).pathname
  const rest = path.replace(/^.*\/api\/v1\/self-reviews\/?/, '')
  return rest === '' ? [] : rest.split('/').map(decodeURIComponent)
}

/** The blocks a sitting leaves on each match, in sitting order. */
function blocksByMatch(reviews: SelfReviewWire[]): Map<string, MatchSelfReviewNote[]> {
  const out = new Map<string, MatchSelfReviewNote[]>()
  const bySitting = [...reviews].sort((a, b) => a.created_at.localeCompare(b.created_at))
  for (const r of bySitting) {
    for (const n of Object.values(r.notes)) {
      const block: MatchSelfReviewNote = {
        review_id: r.review_id, review_created_at: r.created_at, kind: n.kind, text: n.text,
        updated_at: n.updated_at, focus_tags: n.focus_tags, extra_tags: n.extra_tags,
        ...(r.title ? { review_title: r.title } : {}),
        ...(r.finished_at ? { review_finished_at: r.finished_at } : {}),
        ...(n.match_clock ? { match_clock: n.match_clock } : {}),
        ...(n.moments && n.moments.length ? { moments: n.moments } : {}),
      }
      out.set(n.match_key, [...(out.get(n.match_key) ?? []), block])
    }
  }
  return out
}

/**
 * Mock the whole self-review surface AND the matches list (with the blocks
 * the sittings put on each match). Call before `page.goto`.
 */
export async function mockSelfReviews(page: Page, opts: SelfReviewsMockOptions = {}): Promise<SelfReviewsMock> {
  const state = {
    reviews: new Map<string, SelfReviewWire>((opts.reviews ?? []).map((r) => [r.review_id, r])),
    minted: 0,
  }
  const matches = opts.matches ?? SESSION_FIXTURE.matches
  const mock: SelfReviewsMock = {
    created: routeCapture('self review POST body'),
    notePut: routeCapture('self review note PUT body'),
    notePutKey: routeCapture('self review note PUT match key'),
    momentPut: routeCapture('self review moment PUT body'),
    momentPutId: routeCapture('self review moment PUT id'),
    updatePut: routeCapture('self review PUT body'),
    focusPut: routeCapture('self review focus items PUT body'),
    finished: [],
    deleted: [],
    reviews: () => [...state.reviews.values()],
  }

  await page.route('**/api/v1/matches', async (route: Route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback()
      return
    }
    const blocks = blocksByMatch(mock.reviews())
    await fulfillJSON(route, matches.map((m) => {
      const mine = blocks.get(m.match_key)
      return mine ? { ...m, self_review_notes: mine } : m
    }))
  })

  // Two globs, one handler: Playwright's `*` stops at a slash, so the
  // collection and the per-sitting paths are registered separately.
  const selfReviewRoutes = async (route: Route) => {
    const method = route.request().method()
    const seg = segments(route)
    // Collection.
    if (seg.length === 0) {
      if (method === 'GET') {
        await fulfillJSON(route, [...state.reviews.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)))
        return
      }
      if (method === 'POST') {
        const body = parseBody<{ title?: string; match_keys: string[] }>(route)
        mock.created.set(body)
        const id = state.minted === 0 ? SITTING_ID : `${OTHER_SITTING_ID.slice(0, -1)}${state.minted}`
        state.minted += 1
        const created: SelfReviewWire = {
          review_id: id, title: body.title ?? '', focus_items: [], created_at: nowIso(), updated_at: nowIso(),
          match_keys: [...new Set(body.match_keys)], notes: {},
        }
        state.reviews.set(id, created)
        await fulfillJSON(route, created, 201)
        return
      }
      await route.fallback()
      return
    }
    const review = state.reviews.get(seg[0]!)
    if (!review) {
      await (method === 'DELETE' && seg.length === 1
        ? route.fulfill({ status: 204 })
        : fulfillProblem(route, 404, 'self review not found'))
      return
    }
    await handleSittingRoute(route, seg, review, { reviews: state.reviews, mock })
  }
  await page.route('**/api/v1/self-reviews', selfReviewRoutes)
  await page.route('**/api/v1/self-reviews/**', selfReviewRoutes)
  return mock
}

/** One sitting's routes, dispatched by shape: /{id} · /{id}/matches · /{id}/completion · /{id}/notes/… */
async function handleSittingRoute(route: Route, seg: string[], review: SelfReviewWire, ctx: MockContext): Promise<void> {
  const method = route.request().method()
  if (seg.length === 1) return handleSittingHeader(route, method, review, ctx)
  if (seg.length === 2 && seg[1] === 'matches' && method === 'PUT') return handleSetMatches(route, review)
  if (seg.length === 2 && seg[1] === 'focus-items' && method === 'PUT') {
    const body = parseBody<{ items: FocusItemWire[] }>(route)
    ctx.mock.focusPut.set(body)
    // Items written in a sitting are born working: the player wrote them,
    // so they are already on them. The server does this; the mock has to,
    // or a spec reading the status back proves nothing.
    review.focus_items = body.items.map((i) => ({ ...i, status: i.status ?? 'working' }))
    review.updated_at = nowIso()
    return fulfillJSON(route, review)
  }
  if (seg.length === 2 && seg[1] === 'completion' && method === 'POST') {
    review.finished_at ??= nowIso()
    ctx.mock.finished.push(review.review_id)
    return fulfillJSON(route, review)
  }
  return handleNoteRoutes(route, seg, review, ctx.mock)
}

interface MockContext { reviews: Map<string, SelfReviewWire>; mock: SelfReviewsMock }

function handleSittingHeader(route: Route, method: string, review: SelfReviewWire, ctx: MockContext): Promise<void> {
  if (method === 'GET') return fulfillJSON(route, review)
  if (method === 'PUT') {
    const body = parseBody<{ title: string }>(route)
    ctx.mock.updatePut.set(body)
    review.title = body.title
    review.updated_at = nowIso()
    return fulfillJSON(route, review)
  }
  if (method === 'DELETE') {
    ctx.reviews.delete(review.review_id)
    ctx.mock.deleted.push(review.review_id)
    return route.fulfill({ status: 204 })
  }
  return route.fallback()
}

function handleSetMatches(route: Route, review: SelfReviewWire): Promise<void> {
  const body = parseBody<{ match_keys: string[] }>(route)
  review.match_keys = [...new Set(body.match_keys)]
  for (const k of Object.keys(review.notes)) if (!review.match_keys.includes(k)) delete review.notes[k]
  return fulfillJSON(route, review)
}

/** /{id}/notes/{match_key}[/moments/{moment_id}] */
function handleNoteRoutes(route: Route, seg: string[], review: SelfReviewWire, mock: SelfReviewsMock): Promise<void> {
  const method = route.request().method()
  if (seg[1] !== 'notes' || seg.length < 3) return route.fallback()
  const matchKey = seg[2]!
  if (!review.match_keys.includes(matchKey)) return fulfillProblem(route, 404, 'match is not in this self review')
  const address = { review, matchKey, mock }
  if (seg.length === 3) return handleNoteRoute(route, method, address)
  if (seg.length === 5 && seg[3] === 'moments') return handleMomentRoute(route, method, { ...address, momentId: seg[4]! })
  return route.fallback()
}

interface NoteAddress { review: SelfReviewWire; matchKey: string; mock: SelfReviewsMock }

function handleNoteRoute(route: Route, method: string, { review, matchKey, mock }: NoteAddress): Promise<void> {
  if (method === 'PUT') {
    const body = parseBody<SelfReviewNotePutBody>(route)
    mock.notePut.set(body)
    mock.notePutKey.set(matchKey)
    const prev = review.notes[matchKey]
    const stamp = nowIso()
    review.notes[matchKey] = {
      match_key: matchKey, kind: body.kind as 'note' | 'reviewed_only', text: body.text,
      focus_tags: body.focus_tags ?? [], extra_tags: body.extra_tags ?? [], match_clock: body.match_clock ?? '',
      ...(prev?.moments ? { moments: prev.moments } : {}),
      created_at: prev?.created_at ?? stamp, updated_at: stamp,
    }
    return fulfillJSON(route, review.notes[matchKey])
  }
  if (method === 'DELETE') {
    delete review.notes[matchKey]
    return route.fulfill({ status: 204 })
  }
  return route.fallback()
}

function handleMomentRoute(route: Route, method: string, { review, matchKey, momentId, mock }: NoteAddress & { momentId: string }): Promise<void> {
  if (method === 'PUT') {
    const body = parseBody<SelfReviewMomentPutBody>(route)
    mock.momentPut.set(body)
    mock.momentPutId.set(momentId)
    const stamp = nowIso()
    // A moment on a match with no note opens a reviewed_only note.
    review.notes[matchKey] ??= {
      match_key: matchKey, kind: 'reviewed_only', text: '', focus_tags: [], extra_tags: [], match_clock: '',
      created_at: stamp, updated_at: stamp,
    }
    const note = review.notes[matchKey]
    const moment = { moment_id: momentId, match_clock: body.match_clock, text: body.text, ...(body.focus_tag ? { focus_tag: body.focus_tag } : {}) }
    const rest = (note.moments ?? []).filter((m) => m.moment_id !== momentId)
    note.moments = [...rest, moment].sort((a, b) => a.match_clock.localeCompare(b.match_clock))
    return fulfillJSON(route, moment)
  }
  if (method === 'DELETE') {
    const note = review.notes[matchKey]
    if (note) note.moments = (note.moments ?? []).filter((m) => m.moment_id !== momentId)
    return route.fulfill({ status: 204 })
  }
  return route.fallback()
}

/** One row of `GET /api/v1/focus` — the player's whole list. */
export interface FocusEntryWire {
  item_id: string
  text: string
  status: 'new' | 'working' | 'done'
  source: 'coach' | 'self'
  coach_name?: string
  from: string
}

export interface FocusMock {
  /** Status moves the band sent, in order. */
  moves: { itemID: string; status: string }[]
  entries: () => FocusEntryWire[]
}

/**
 * `GET /api/v1/focus` + `PUT /api/v1/focus/{item_id}/status`, live: a move
 * mutates the list, so a refetch after Accept reads what was written. The
 * server assembles the order (coach items first) — the mock serves whatever
 * it was handed, which is what lets a spec pin that the band does not
 * re-sort.
 */
export async function mockFocus(page: Page, entries: FocusEntryWire[] = []): Promise<FocusMock> {
  const state = [...entries]
  const mock: FocusMock = { moves: [], entries: () => [...state] }

  await page.route('**/api/v1/focus', async (route: Route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback()
      return
    }
    await fulfillJSON(route, state)
  })
  await page.route('**/api/v1/focus/*/status', async (route: Route) => {
    const parts = new URL(route.request().url()).pathname.split('/')
    const itemID = parts[parts.length - 2] ?? ''
    const body = parseBody<{ status: FocusEntryWire['status'] }>(route)
    const row = state.find((e) => e.item_id === itemID)
    if (!row) {
      await fulfillProblem(route, 404, 'focus item not found')
      return
    }
    row.status = body.status
    mock.moves.push({ itemID, status: body.status })
    await route.fulfill({ status: 204, body: '' })
  })
  return mock
}
