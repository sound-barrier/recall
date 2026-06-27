/**
 * Real-server native backup round-trip — GET /api/v1/database (a VACUUM INTO
 * snapshot) then PUT /api/v1/database (validate → file-swap → reopen) against
 * the actual binary, so pkg/db/backup.go and pkg/app/backup.go run for real. No
 * api mocking.
 *
 * Two provenance cases, because they stress different layers of the same cycle:
 *   1. MANUAL matches + the annotation / hidden sidecars (the user-data rows).
 *   2. An OCR-parsed match that's been EDITED — the hard case: the parsed parent
 *      rows AND the user override that shadows them must BOTH survive, and the
 *      restored match must still report the edited values with source=ocr_edited
 *      (not the stale OCR originals, not a plain ocr match that dropped the
 *      edits). A byte-for-byte SQLite snapshot should preserve all of it; this
 *      proves the validate-and-swap restore actually reopens the new file.
 *
 * NB: this is the full-fidelity backup/restore (native .db). The /exports/bundle
 * ZIP is a separate share format (recall-bundle/v1 envelope + screenshots) that
 * the additive POST /api/v1/imports merge consumes — see
 * export-bundle-roundtrip.spec.ts.
 */
import { expect, test } from './_fixtures'
import { createMatch, listMatches, manual, parseGolden, reset, stageGolden, unstageGolden, type Match } from './_real-server'

test.describe('backup round-trip — manual matches + sidecars (real server)', () => {
  test.beforeEach(async ({ request }) => reset(request))

  test.afterEach(async ({ request }) => reset(request))

  test('export then import preserves rows, annotation, and hidden flag', async ({ request }) => {
    // Three matches: one hidden, one annotated, one plain.
    const hiddenM = await createMatch(request, manual({ played_at: '2026-06-15T18:00:00Z' }))
    const notedM = await createMatch(request, manual({ played_at: '2026-06-15T18:01:00Z', note: 'great comeback' }))
    await createMatch(request, manual({ played_at: '2026-06-15T18:02:00Z' }))
    expect((await request.put(`/api/v1/matches/${encodeURIComponent(hiddenM.match_key)}/visibility`, { data: { hidden: true } })).status()).toBe(204)

    // Snapshot the whole DB (native .db).
    const exp = await request.get('/api/v1/database')
    expect(exp.status()).toBe(200)
    const payload = await exp.body()
    expect(payload.byteLength).toBeGreaterThan(0)

    // Wipe to a fresh install, then restore the snapshot.
    await reset(request)
    expect(await listMatches(request)).toHaveLength(0)

    const imp = await request.put('/api/v1/database', {
      headers: { 'Content-Type': 'application/octet-stream' },
      data: payload,
    })
    expect(imp.status(), await imp.text().catch(() => '')).toBe(204)

    // Every match came back, with its sidecars intact.
    const all = await listMatches(request)
    expect(all).toHaveLength(3)
    expect(all.find((m) => m.match_key === hiddenM.match_key)?.hidden).toBe(true)
    expect(all.find((m) => m.match_key === notedM.match_key)?.annotation?.note).toBe('great comeback')
  })
})

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

test.describe('backup round-trip — edited OCR match (real server)', () => {
  test.beforeEach(async ({ request }) => {
    await reset(request)
    stageGolden()
  })

  test.afterEach(async ({ request }) => {
    await reset(request)
    await unstageGolden(request)
  })

  test('the edits still win after export → wipe → import', async ({ request }) => {
    // Mint a real OCR match, then edit it + annotate it.
    const ocrKey = (await parseGolden(request)).match_key
    expect([200, 204]).toContain((await request.put(`/api/v1/matches/${ocrKey}/data`, { data: EDITS })).status())
    expect((await request.put(`/api/v1/matches/${ocrKey}/annotation`, { data: { note: NOTE, tags: [TAG] } })).status()).toBe(204)

    // Sanity: the override took effect before we touch the backup at all.
    assertEditedOcrMatch((await listMatches(request)).find((m) => m.match_key === ocrKey), 'pre-export')

    // Full DB snapshot → wipe → restore.
    const exp = await request.get('/api/v1/database')
    expect(exp.status()).toBe(200)
    const payload = await exp.body()
    expect(payload.byteLength).toBeGreaterThan(0)

    await reset(request)
    expect(await listMatches(request)).toHaveLength(0)

    const imp = await request.put('/api/v1/database', {
      headers: { 'Content-Type': 'application/octet-stream' },
      data: payload,
    })
    expect(imp.status(), await imp.text().catch(() => '')).toBe(204)

    // The restored match is byte-for-byte the edited one.
    assertEditedOcrMatch((await listMatches(request)).find((m) => m.match_key === ocrKey), 'post-import')
  })
})
