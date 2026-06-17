/**
 * Shared helpers for the real-server e2e specs (no api mocking). Every call hits
 * the actual serveronly binary so the Go stack is exercised end-to-end; state is
 * isolated by the RECALL_E2E-gated reset seam. Not a *.spec.ts file, so the test
 * runner ignores it (it's a helper module, like _fixtures.ts).
 */
import { type APIRequestContext, expect } from '@playwright/test'

export const RESET = '/api/v1/system/test-reset'

export interface Match {
  match_key: string
  source?: string
  hidden?: boolean
  queue_type?: string
  reviewed_by?: string
  annotation?: { note?: string; tags?: string[] }
  data?: {
    map?: string
    result?: string
    damage?: number
    heroes_played?: { hero: string; percent_played?: number }[]
  }
}

export interface Profiles {
  active: string
  profiles: string[]
}

export function manual(overrides: Record<string, unknown> = {}) {
  return { map: 'ilios', play_mode: 'competitive', queue_type: 'open', heroes: ['ana'], result: 'victory', ...overrides }
}

export async function reset(request: APIRequestContext) {
  expect((await request.post(RESET)).status()).toBe(204)
}

export async function createMatch(request: APIRequestContext, body: Record<string, unknown>): Promise<Match> {
  const r = await request.post('/api/v1/matches', { data: body })
  expect(r.status(), await r.text()).toBe(201)
  return r.json() as Promise<Match>
}

export async function listMatches(request: APIRequestContext): Promise<Match[]> {
  const r = await request.get('/api/v1/matches')
  expect(r.status()).toBe(200)
  return r.json() as Promise<Match[]>
}

export async function getProfiles(request: APIRequestContext): Promise<Profiles> {
  const r = await request.get('/api/v1/profiles')
  expect(r.status()).toBe(200)
  return r.json() as Promise<Profiles>
}

export async function switchProfile(request: APIRequestContext, name: string) {
  const r = await request.put('/api/v1/profiles/active', { data: { name } })
  expect(r.status()).toBe(200)
}
