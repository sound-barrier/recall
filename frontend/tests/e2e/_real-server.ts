/**
 * Shared helpers for the real-server e2e specs (no api mocking). Every call hits
 * the actual serveronly binary so the Go stack is exercised end-to-end; state is
 * isolated by the RECALL_E2E-gated reset seam. Not a *.spec.ts file, so the test
 * runner ignores it (it's a helper module, like _fixtures.ts).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { type APIRequestContext, expect } from '@playwright/test'

export const RESET = '/api/v1/system/test-reset'

export interface Match {
  match_key: string
  source?: string
  source_files?: string[]
  hidden?: boolean
  queue_type?: string
  reviewed_by?: string
  annotation?: { note?: string; tags?: string[] }
  data?: {
    map?: string
    result?: string
    final_score?: string
    finished_at?: string
    game_length?: string
    eliminations?: number
    assists?: number
    deaths?: number
    damage?: number
    healing?: number
    mitigation?: number
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

// ─── Real OCR parse (Tesseract pipeline) ────────────────────────────────────
// Several specs need a genuine ocr / ocr_edited match, which can only be minted
// by parsing a real screenshot (OCR rows can't be injected via the API). These
// keep the slow, fiddly staging in one place: stage the committed golden, run
// the pipeline, hand back the parsed record.

const TESTDATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../testdata')
const GOLDEN = 'Overwatch 2 Screenshot 2026.05.10 - 21.49.34.41.png'

// Scratch folder the server watches during a parse. Safe to share across specs:
// the suite runs workers: 1 and every parse spec resets + unstages per test.
export const GOLDEN_SHOTS_DIR = '/tmp/recall-e2e-golden'

// stageGolden drops a clean copy of the golden screenshot into `dir`.
export function stageGolden(dir: string = GOLDEN_SHOTS_DIR) {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  fs.copyFileSync(path.join(TESTDATA, GOLDEN), path.join(dir, GOLDEN))
}

// unstageGolden un-bleeds the folder setting and removes the scratch dir.
export async function unstageGolden(request: APIRequestContext, dir: string = GOLDEN_SHOTS_DIR) {
  await request.delete('/api/v1/settings/screenshots-folder')
  fs.rmSync(dir, { recursive: true, force: true })
}

// parseGolden points the server at `dir`, runs the real Tesseract → parser →
// store pipeline, and returns the parsed (non-manual) match. OCR output drifts
// across Tesseract versions, so callers assert only on fields they subsequently
// edit — never on what the golden happened to OCR to. Generous timeout: OCR
// shells out per image.
export async function parseGolden(request: APIRequestContext, dir: string = GOLDEN_SHOTS_DIR): Promise<Match> {
  expect([200, 204]).toContain((await request.put('/api/v1/settings/screenshots-folder', { data: { path: dir } })).status())
  expect([200, 202]).toContain((await request.post('/api/v1/parses')).status())
  await expect
    .poll(async () => (await listMatches(request)).length, { timeout: 90_000, intervals: [1000] })
    .toBeGreaterThan(0)
  const parsed = (await listMatches(request)).find((m) => m.source !== 'manual')
  expect(parsed, 'a parsed (non-manual) match should exist after the OCR run').toBeTruthy()
  return parsed!
}
