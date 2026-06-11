/**
 * Export → import roundtrip E2E.
 *
 * The export-side flow is covered by `match-export-bundle.spec.ts` —
 * this spec covers the missing import-side leg: the
 * Settings → Backup & Restore → Import Backup… → Choose File…
 * → POST /api/v1/imports → afterImport reload contract.
 *
 * Drives the full transport chain in a real browser:
 *   1. Settings → Advanced → Backup & Restore.
 *   2. Two-step arm/confirm: "Import Backup…" → "Choose File…".
 *   3. The transient `<input type=file>` accepts the JSON payload
 *      via Playwright's filechooser handler.
 *   4. POST /api/v1/imports fires with Content-Type:
 *      application/json and the file body bytes.
 *   5. On 200, the composable calls `afterImport()` which re-loads
 *      GET /api/v1/matches — the imported record now renders.
 */
import { test, expect } from './_fixtures'

const IMPORTED_KEY = 'match-2026-05-10T22-21-11'

const importedPayload = {
  // Minimal-but-realistic exported-JSON envelope. The server's
  // schema-peek decode only inspects the top-level shape; the
  // round-trip contract is the bytes the FE sends == the bytes
  // the server accepts, not the full pkg/app/import.go merge.
  version: 1,
  matches: [
    {
      match_key: IMPORTED_KEY,
      source_files: [`${IMPORTED_KEY}.png`],
      data: {
        map:           'rialto',
        playlist:          'competitive',
        type:          'control',
        role:          'support',
        hero:          'lucio',
        result:        'victory',
        date:          '2026-05-10',
        finished_at:   '22:21',
        eliminations: 12,
        assists:       8,
        deaths:        3,
        damage:     5500,
        heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '10:00' }],
      },
      parsed_at: '2026-05-10T23:30:00Z',
    },
  ],
}

test.describe('backup roundtrip — import side', () => {
  test('arm → choose file → POST /imports → reload matches', async ({ page }) => {
    let matchesCalls = 0
    let importBody: { method: string; contentType: string; bytes: string } | null = null

    await page.route('**/api/v1/matches', async (route) => {
      matchesCalls++
      // First call: empty corpus. After the import, the FE's
      // afterImport()→load() fires a second GET; return the
      // imported row so the spec can assert it landed.
      const records = matchesCalls === 1 ? [] : importedPayload.matches
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(records),
      })
    })

    await page.route('**/api/v1/imports', async (route) => {
      const req = route.request()
      // route.request().postData() returns a string; treat it as
      // the JSON payload the FE sent. (We don't decode it; this
      // spec asserts the transport shape, not the server's
      // semantic ingestion — the latter is pkg/app/import.go's
      // Go test surface.)
      importBody = {
        method:      req.method(),
        contentType: req.headers()['content-type'] ?? '',
        bytes:       req.postData() ?? '',
      }
      await route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' })
    })

    await page.goto('/')
    await page.locator('#tab-settings').click()

    // Backup & Restore section is collapsible-but-default-open;
    // scroll into view to make sure the click target is hittable.
    const armBtn = page.getByRole('button', { name: /Import Backup/ })
    await armBtn.scrollIntoViewIfNeeded()
    await armBtn.click()

    // The danger-row confirm exposes the "Choose File…" button.
    // The button text becomes "Loading…" mid-import, so match the
    // initial label.
    const confirmBtn = page.getByRole('button', { name: /Choose File/ })
    await expect(confirmBtn).toBeVisible()

    // The FE creates a transient `<input type=file>` and clicks it.
    // Playwright catches that via filechooser.
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      confirmBtn.click(),
    ])
    await chooser.setFiles({
      name:     'recall-backup.json',
      mimeType: 'application/json',
      buffer:   Buffer.from(JSON.stringify(importedPayload), 'utf-8'),
    })

    // POST /api/v1/imports fires with the file bytes.
    await expect.poll(() => importBody).not.toBeNull()
    expect(importBody?.method).toBe('POST')
    expect(importBody?.contentType).toBe('application/json')
    expect(importBody?.bytes).toBe(JSON.stringify(importedPayload))

    // Composable's `afterImport: () => load()` re-runs GET /matches.
    await expect.poll(() => matchesCalls).toBeGreaterThanOrEqual(2)

    // Status chip surfaces success with the file name. The chip
    // auto-clears, so assert visibility before the timer fires.
    await expect(page.getByText(/Imported: recall-backup\.json/)).toBeVisible()
  })
})
