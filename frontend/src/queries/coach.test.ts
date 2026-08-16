import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { effectScope } from 'vue'

import { ApiError } from '@/api'
import { setApiBacking } from '@/api-client'
import { getQueryClient } from '@/queries/client'
import { qk } from '@/queries/keys'
import {
  setCoachSessionResume,
  useCoachReturnsQuery,
  useCoachSessionMatchesQuery,
  useCoachSessionQuery,
} from '@/queries/coach'
import { COACH_SESSION_RESUME_KEY } from '@/composables/shared/storageKeys'

// The session query is the one read that must NOT fire on a normal boot:
// a coach with no session open would pay a 404 round-trip on every launch
// (and the e2e counts those GETs). The resume flag in localStorage is the
// gate — it is written when a session opens and cleared when it ends, so
// only a reload MID-session asks the server anything.

const VIEW = {
  player: { id: 'p-1', handle: 'Sable', message: '' },
  exported_at: '2026-08-14T18:30:00Z',
  session_date: '2026-08-15',
  match_count: 2,
  coach_name: 'Ordo',
  summary: '',
  notes: [],
  handle_from_bundle: true,
}

const scopes: ReturnType<typeof effectScope>[] = []

// Query observers are created inside an effect scope the way a Pinia store
// setup does it, so each test's observers are disposed with the scope.
function inScope<T>(create: () => T): T {
  const scope = effectScope()
  scopes.push(scope)
  return scope.run(create) as T
}

// Query results land after the notifyManager's scheduling, not on the
// microtask queue — a macrotask tick is the reliable settle point.
function settle(): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, 0) })
}

function stubStorage(): void {
  const store: Record<string, string> = {}
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = String(value) },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { for (const k of Object.keys(store)) delete store[k] },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length },
  })
}

let api: Record<string, ReturnType<typeof vi.fn>>

beforeEach(() => {
  stubStorage()
  api = {
    GetCoachSession: vi.fn(async () => VIEW),
    GetCoachSessionMatches: vi.fn(async () => [{ match_key: 'm-1', source_files: [], data: {} }]),
    ListCoachReturns: vi.fn(async () => []),
  }
  setApiBacking(api)
  setCoachSessionResume(false)
})

afterEach(() => {
  scopes.splice(0).forEach(s => { s.stop() })
  vi.unstubAllGlobals()
})

describe('useCoachSessionQuery — the resume gate', () => {
  it('asks the server for nothing when the resume flag is unset', async () => {
    inScope(() => useCoachSessionQuery())
    await settle()
    expect(api.GetCoachSession).not.toHaveBeenCalled()
  })

  it('resumes the open session when the flag is set', async () => {
    setCoachSessionResume(true)
    const query = inScope(() => useCoachSessionQuery())
    await settle()

    expect(api.GetCoachSession).toHaveBeenCalledTimes(1)
    expect(query.data.value).toEqual(VIEW)
  })

  it('reads a 404 as "no session", not as an error', async () => {
    setCoachSessionResume(true)
    api.GetCoachSession = vi.fn(async () => { throw new ApiError(404, 'no coaching session is open') })
    setApiBacking(api)

    const query = inScope(() => useCoachSessionQuery())
    await settle()

    expect(query.data.value).toBeNull()
    expect(query.error.value).toBeNull()
  })

  it('surfaces a non-404 failure as an error rather than a phantom "no session"', async () => {
    setCoachSessionResume(true)
    api.GetCoachSession = vi.fn(async () => { throw new ApiError(500, 'boom') })
    setApiBacking(api)

    const query = inScope(() => useCoachSessionQuery())
    await settle()

    expect(query.data.value).toBeUndefined()
    expect(query.error.value).toBeInstanceOf(ApiError)
  })
})

describe('setCoachSessionResume', () => {
  it('writes the flag when a session opens and clears it when one ends', () => {
    setCoachSessionResume(true)
    expect(localStorage.getItem(COACH_SESSION_RESUME_KEY)).toBe('true')
    setCoachSessionResume(false)
    expect(localStorage.getItem(COACH_SESSION_RESUME_KEY)).toBeNull()
  })
})

describe('useCoachSessionMatchesQuery', () => {
  it('stays idle until a session is actually open', async () => {
    const active = inScope(() => useCoachSessionMatchesQuery(() => false))
    await settle()
    expect(api.GetCoachSessionMatches).not.toHaveBeenCalled()
    expect(active.data.value).toBeUndefined()
  })

  it('loads the loaned corpus once a session is open', async () => {
    const query = inScope(() => useCoachSessionMatchesQuery(() => true))
    await settle()
    expect(api.GetCoachSessionMatches).toHaveBeenCalledTimes(1)
    expect(query.data.value).toHaveLength(1)
  })
})

describe('useCoachReturnsQuery', () => {
  // Unlike the session, the player's inbox has to be known on a COLD boot:
  // the Matches banner nags until every returned note is decided, and the
  // sheet is staged server-side, so there is no local flag to gate on.
  it('reads the staged returns at boot', async () => {
    const query = inScope(() => useCoachReturnsQuery())
    await settle()
    expect(api.ListCoachReturns).toHaveBeenCalledTimes(1)
    expect(query.data.value).toEqual([])
  })
})

describe('the coach key taxonomy', () => {
  it('nests the loaned corpus under the session so one invalidation catches both', () => {
    expect(qk.coach.matches.slice(0, qk.coach.session.length)).toEqual([...qk.coach.session])
  })

  it('keeps the returns inbox on its own branch', () => {
    expect(getQueryClient()).toBeTruthy()
    expect(qk.coach.returns).not.toEqual(qk.coach.session)
  })
})
