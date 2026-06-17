/**
 * Real Tesseract → parser → store pipeline. A committed golden screenshot is
 * copied into a watched folder, parsed by the actual `serveronly` binary via
 * POST /parses, and we assert a match record landed. This is the single biggest
 * lever for Go *integration* coverage (pkg/parser is ~0% otherwise) — the rest
 * of the suite mocks or never reaches the OCR path.
 *
 * OCR output drifts across Tesseract versions, so the assertions stay LOOSE:
 * we check that the parse produced a stored, non-manual record — not its exact
 * parsed fields (those are pinned by the Go golden tests at the matching
 * Tesseract version, not here).
 *
 * Requires Tesseract on PATH (the server auto-detects via exec.LookPath); the
 * e2e CI job installs it (see e2e.yml), and `task test-e2e` relies on the local
 * install.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from './_fixtures'
import { listMatches, reset } from './_real-server'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TESTDATA = path.resolve(HERE, '../../../testdata')
const GOLDEN = 'Overwatch 2 Screenshot 2026.05.10 - 21.49.34.41.png'
const SHOTS_DIR = '/tmp/recall-e2e-parse'

test.describe('golden screenshot parse (real server + Tesseract)', () => {
  test.beforeEach(async ({ request }) => {
    await reset(request)
    fs.rmSync(SHOTS_DIR, { recursive: true, force: true })
    fs.mkdirSync(SHOTS_DIR, { recursive: true })
    fs.copyFileSync(path.join(TESTDATA, GOLDEN), path.join(SHOTS_DIR, GOLDEN))
  })

  test.afterEach(async ({ request }) => {
    await reset(request)
    await request.delete('/api/v1/settings/screenshots-folder') // un-bleed the folder setting
    fs.rmSync(SHOTS_DIR, { recursive: true, force: true })
  })

  test('parses a golden screenshot into a stored match record', async ({ request }) => {
    // Point the server at the folder holding the golden.
    expect([200, 204]).toContain((await request.put('/api/v1/settings/screenshots-folder', { data: { path: SHOTS_DIR } })).status())

    // Kick the parse (async — 202).
    expect([200, 202]).toContain((await request.post('/api/v1/parses')).status())

    // The Tesseract → parser → store pipeline lands a record. Generous timeout
    // (OCR shells out per image, several passes).
    await expect
      .poll(async () => (await listMatches(request)).length, { timeout: 90_000, intervals: [1000] })
      .toBeGreaterThan(0)

    // It came from the parse, not a manual entry.
    expect((await listMatches(request)).every((m) => m.source !== 'manual')).toBe(true)
  })
})
