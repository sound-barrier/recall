/**
 * Real-server bundle → merge-import round-trip.
 *
 * The export-side flow is covered by `match-export-bundle.spec.ts`; this spec
 * covers the merge-import leg against the actual binary, so pkg/app/export_bundle.go
 * (the recall-bundle/v1 ZIP) and pkg/app/import_matches.go (additive merge) run
 * for real. No api mocking.
 *
 *   1. Parse a real OCR match.
 *   2. POST /api/v1/exports/bundle → a recall-bundle/v1 ZIP (manifest +
 *      data.json + screenshots).
 *   3. Wipe the DB.
 *   4. POST /api/v1/imports the ZIP → 200 {imported:1, skipped:0}; the match
 *      reappears (data-only — the parsed rows merge back in).
 *   5. Re-import the same bundle → {imported:0, skipped:1}; the existing key is
 *      skipped and nothing is duplicated (additive, non-destructive).
 *
 * The browser-driven import UI (Settings + Matches toolbar) is covered by
 * import-matches.spec.ts.
 */
import { expect, test } from './_fixtures'
import { listMatches, parseGolden, reset, stageGolden, unstageGolden } from './_real-server'

type ImportSummary = { imported: number; skipped: number }

test.describe('bundle → merge-import round-trip (real server)', () => {
  test.beforeEach(async ({ request }) => {
    await reset(request)
    stageGolden()
  })

  test.afterEach(async ({ request }) => {
    await reset(request)
    await unstageGolden(request)
  })

  test('export a bundle, wipe, merge it back — then re-import skips the dup', async ({ request }) => {
    const ocrKey = (await parseGolden(request)).match_key

    // Export a bundle for the parsed match.
    const bundleResp = await request.post('/api/v1/exports/bundle', {
      data: { match_keys: [ocrKey], include_unknown: false, include_hidden: false },
    })
    expect(bundleResp.status()).toBe(200)
    const bundle = await bundleResp.body()
    expect(bundle.byteLength).toBeGreaterThan(0)

    // Wipe, then merge the bundle back in.
    await reset(request)
    expect(await listMatches(request)).toHaveLength(0)

    const firstImport = await request.post('/api/v1/imports', {
      headers: { 'Content-Type': 'application/zip' },
      data: bundle,
    })
    expect(firstImport.status(), await firstImport.text().catch(() => '')).toBe(200)
    expect((await firstImport.json()) as ImportSummary).toEqual({ imported: 1, skipped: 0 })

    const restored = await listMatches(request)
    expect(restored.some((m) => m.match_key === ocrKey)).toBe(true)

    // Re-importing the same bundle is additive: the existing key is skipped,
    // nothing is wiped or duplicated.
    const secondImport = await request.post('/api/v1/imports', {
      headers: { 'Content-Type': 'application/zip' },
      data: bundle,
    })
    expect(secondImport.status()).toBe(200)
    expect((await secondImport.json()) as ImportSummary).toEqual({ imported: 0, skipped: 1 })
    expect(await listMatches(request)).toHaveLength(restored.length)
  })
})
