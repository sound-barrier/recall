/**
 * Real Tesseract → parser → store pipeline: the canonical proof that a committed
 * golden screenshot parses into a stored match record through the actual
 * serveronly binary. The shared `parseGolden` helper (reused by the CSV-export
 * and backup-roundtrip specs) owns the staging + parse; this spec is its
 * dedicated assertion that the pipeline produces a real OCR record. It's the
 * single biggest lever for Go *integration* coverage (pkg/parser is ~0%
 * otherwise).
 *
 * Assertions stay LOOSE — OCR output drifts across Tesseract versions, so we
 * check provenance (a non-manual record carrying parsed screenshot rows), not
 * exact parsed fields (those are pinned by the Go golden tests at the matching
 * Tesseract version).
 *
 * Requires Tesseract on PATH (the server auto-detects via exec.LookPath); the
 * e2e CI job installs it, and `task test-e2e` relies on the local install.
 */
import { expect, test } from './_fixtures'
import { parseGolden, reset, stageGolden, unstageGolden } from './_real-server'

test.describe('golden screenshot parse (real server + Tesseract)', () => {
  test.beforeEach(async ({ request }) => {
    await reset(request)
    stageGolden()
  })

  test.afterEach(async ({ request }) => {
    await reset(request)
    await unstageGolden(request)
  })

  test('parses a golden screenshot into a stored OCR match record', async ({ request }) => {
    const parsed = await parseGolden(request)
    // Provenance, not exact fields: a parsed, unedited record with real
    // screenshot rows behind it.
    expect(parsed.source).toBe('ocr')
    expect((parsed.source_files ?? []).length).toBeGreaterThan(0)
  })
})
