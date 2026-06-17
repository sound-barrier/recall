/**
 * The bug surface the maintainer cares about most: a user alters a match and
 * the change must survive a full database backup → wipe → restore — AND keep
 * winning over the original.
 *
 * The hard case is an OCR-parsed match that's been EDITED. Such a match carries
 * two layers in the DB: the parsed screenshot rows (the parent tables) and the
 * user override (user_match_data) that shadows them. A correct round-trip has to
 *   (a) export BOTH layers,
 *   (b) re-import BOTH layers, and
 *   (c) re-apply override-wins so the restored match still reports the edited
 *       values and `source = ocr_edited` — not the stale OCR originals, and not
 *       a plain `ocr` match that quietly dropped the edits.
 *
 * The existing backup-roundtrip spec only exercises MANUAL matches plus the
 * annotation/hidden sidecars; it never proves an inline EDIT over OCR survives.
 * A regression in the export's user-layer, the import's re-apply, or the
 * read-time fold would be invisible there but silently revert a user's
 * corrections on every restore.
 *
 * OCR rows can't be injected via the API, so this parses a real golden through
 * Tesseract (as golden-parse does), then asserts hard only on the fields we
 * edited (known sentinels) — tolerant of OCR drift across Tesseract versions.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from './_fixtures'
import { listMatches, reset, type Match } from './_real-server'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TESTDATA = path.resolve(HERE, '../../../testdata')
const GOLDEN = 'Overwatch 2 Screenshot 2026.05.10 - 21.49.34.41.png'
const SHOTS_DIR = '/tmp/recall-e2e-ocr-edit-rt'

// The full override set applied to the parsed match. Distinctive in-range
// sentinels so their survival is unambiguous; `map` is included so the row is
// never an unknown-map record.
const EDITS = {
  map: 'ilios',
  result: 'defeat',
  final_score: '3-1',
  finished_at: '23:45',
  game_length: '12:34',
  eliminations: 42,
  assists: 38,
  deaths: 13,
  damage: 54321,
  healing: 43210,
  mitigation: 32109,
} as const

const NOTE = 'reviewed: threw on point B'
const TAG = 'ranked'

// assertEditedOcrMatch holds the full contract in one place so it can be checked
// identically before export and after restore — the diff between the two calls
// is exactly "did the backup cycle preserve it?".
function assertEditedOcrMatch(m: Match | undefined, when: string) {
  expect(m, `${when}: the edited OCR match should exist`).toBeTruthy()
  // ocr_edited (not ocr, not manual) proves BOTH layers are present: parsed
  // parent rows AND the user override that shadows them.
  expect(m!.source, `${when}: source`).toBe('ocr_edited')
  expect((m!.source_files ?? []).length, `${when}: parsed screenshot rows survive`).toBeGreaterThan(0)
  // Every edited field reports the OVERRIDE value, never the OCR original.
  expect(m!.data?.map, `${when}: map`).toBe('ilios')
  expect(m!.data?.result, `${when}: result`).toBe('defeat')
  expect(m!.data?.final_score, `${when}: final_score`).toBe('3-1')
  expect(m!.data?.finished_at, `${when}: finished_at`).toBe('23:45')
  expect(m!.data?.game_length, `${when}: game_length`).toBe('12:34')
  expect(m!.data?.eliminations, `${when}: eliminations`).toBe(42)
  expect(m!.data?.assists, `${when}: assists`).toBe(38)
  expect(m!.data?.deaths, `${when}: deaths`).toBe(13)
  expect(m!.data?.damage, `${when}: damage`).toBe(54321)
  expect(m!.data?.healing, `${when}: healing`).toBe(43210)
  expect(m!.data?.mitigation, `${when}: mitigation`).toBe(32109)
  // The annotation sidecar rides along too.
  expect(m!.annotation?.note, `${when}: note`).toBe(NOTE)
  expect(m!.annotation?.tags ?? [], `${when}: tags`).toContain(TAG)
}

test.describe('edited OCR match survives a backup round-trip (real server)', () => {
  test.beforeEach(async ({ request }) => {
    await reset(request)
    fs.rmSync(SHOTS_DIR, { recursive: true, force: true })
    fs.mkdirSync(SHOTS_DIR, { recursive: true })
    fs.copyFileSync(path.join(TESTDATA, GOLDEN), path.join(SHOTS_DIR, GOLDEN))
  })

  test.afterEach(async ({ request }) => {
    await reset(request)
    await request.delete('/api/v1/settings/screenshots-folder')
    fs.rmSync(SHOTS_DIR, { recursive: true, force: true })
  })

  test('the edits still win after export → wipe → import', async ({ request }) => {
    // ── Mint a real OCR match, then edit it ────────────────────────────────
    expect([200, 204]).toContain(
      (await request.put('/api/v1/settings/screenshots-folder', { data: { path: SHOTS_DIR } })).status(),
    )
    expect([200, 202]).toContain((await request.post('/api/v1/parses')).status())
    await expect
      .poll(async () => (await listMatches(request)).length, { timeout: 90_000, intervals: [1000] })
      .toBeGreaterThan(0)

    const parsed = (await listMatches(request)).find((m) => m.source !== 'manual')
    expect(parsed, 'a parsed (non-manual) match should exist after the OCR run').toBeTruthy()
    const ocrKey = parsed!.match_key

    expect([200, 204]).toContain((await request.put(`/api/v1/matches/${ocrKey}/data`, { data: EDITS })).status())
    expect((await request.put(`/api/v1/matches/${ocrKey}/annotation`, { data: { note: NOTE, tags: [TAG] } })).status()).toBe(204)

    // Sanity: the override took effect before we touch the backup at all.
    assertEditedOcrMatch((await listMatches(request)).find((m) => m.match_key === ocrKey), 'pre-export')

    // ── Full DB export → wipe → import ─────────────────────────────────────
    const exp = await request.get('/api/v1/exports?format=json')
    expect(exp.status()).toBe(200)
    const payload = await exp.body()
    expect(payload.byteLength).toBeGreaterThan(0)

    await reset(request)
    expect(await listMatches(request)).toHaveLength(0)

    const imp = await request.post('/api/v1/imports', {
      headers: { 'Content-Type': 'application/json' },
      data: payload,
    })
    expect(imp.status(), await imp.text().catch(() => '')).toBe(204)

    // ── The restored match is byte-for-byte the edited one ─────────────────
    const restored = (await listMatches(request)).find((m) => m.match_key === ocrKey)
    assertEditedOcrMatch(restored, 'post-import')
  })
})
