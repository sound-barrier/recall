/**
 * Pinning a frame to a moment.
 *
 * "3:23, no off-angle" is a claim about something you can SEE, and until now
 * the app could only ever point at a file in the watched folder. These bytes
 * are ours: uploaded, addressed by their own content, and served back from
 * /_moment-image/<sha>.
 *
 * The drop is the fast path — you are watching a replay, you drag the capture
 * onto the row. The button is the one that works when the file is not already
 * on screen. This is the first file-drop in the suite, so the DataTransfer is
 * hand-built: the existing drag specs move an id as text/plain and never
 * carry a file.
 */
import type { Page, Route } from '@playwright/test'

import { test, expect } from '../_fixtures'

const DIGEST = 'a'.repeat(64)

function record(momentImage?: string) {
  return {
    match_key: 'match:1',
    source_files: ['a.png'],
    source_types: { 'a.png': 'summary' },
    source_dir_ids: { 'a.png': 0 },
    data: { map: 'ilios', hero: 'ana', result: 'victory', date: '2026-05-10', finished_at: '22:30' },
    parsed_at: '2026-05-10T22:30:00Z',
    moments: [{
      moment_id: 'm-1', match_clock: '03:23', text: 'walked in alone',
      ...(momentImage ? { image_sha256: momentImage } : {}),
    }],
  }
}

async function openJournal(page: Page, momentImage?: string) {
  await page.route('**/api/v1/matches', async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([record(momentImage)]),
    })
  })
  await page.goto('/')
  await page.getByRole('tab', { name: /^Matches/ }).click()
  await page.locator('.leaf-row').first().click()
  await expect(page.locator('aside.detail-panel')).toBeVisible()
}

/** Drop a real File on a locator — the harness has never needed this before. */
async function dropFile(page: Page, selector: string, name: string, type: string) {
  await page.evaluate(async ({ selector, name, type }) => {
    const el = document.querySelector(selector)
    if (!el) throw new Error('no drop target: ' + selector)
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array([1, 2, 3])], name, { type }))
    el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }))
    el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, { selector, name, type })
}

test.describe('a frame pinned to a moment', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
  })

  test('a dropped screenshot is uploaded and saved onto the moment', async ({ page }) => {
    let uploadedType = ''
    let savedDigest = ''
    await page.route('**/api/v1/moment-images', async (route: Route) => {
      uploadedType = route.request().headers()['content-type'] ?? ''
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ sha256: DIGEST, byte_size: 3 }),
      })
    })
    await page.route('**/api/v1/matches/*/moments/*', async (route: Route) => {
      const body = route.request().postDataJSON() as { image_sha256?: string }
      savedDigest = body.image_sha256 ?? ''
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ moment_id: 'm-1', match_clock: '03:23', text: 'walked in alone', image_sha256: DIGEST }),
      })
    })

    await openJournal(page)
    await dropFile(page, '.cue-body', 'shot.png', 'image/png')

    await expect.poll(() => uploadedType).toBe('image/png')
    await expect.poll(() => savedDigest).toBe(DIGEST)
  })

  test('a stored frame is shown, and served from its digest', async ({ page }) => {
    let served = ''
    await page.route(`**/_moment-image/${DIGEST}`, async (route: Route) => {
      served = route.request().url()
      // A 1x1 transparent GIF is enough to prove the URL was requested.
      await route.fulfill({
        status: 200, contentType: 'image/png',
        body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
      })
    })

    await openJournal(page, DIGEST)
    await expect(page.getByRole('img', { name: /^Frame attached to moment/ })).toBeVisible()
    await expect.poll(() => served).toContain(DIGEST)
  })

  test('taking the frame off keeps the moment', async ({ page }) => {
    let savedDigest = 'unset'
    // The corpus mock has to reflect the write. The journal drops its local
    // draft once a save resolves and falls back to what the server says — so
    // a fixture frozen at "still has a frame" would put the picture straight
    // back and hide the very thing under test.
    let stored: string | undefined = DIGEST
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([record(stored)]),
      })
    })
    await page.route('**/api/v1/matches/*/moments/*', async (route: Route) => {
      const body = route.request().postDataJSON() as { image_sha256?: string; text?: string }
      savedDigest = body.image_sha256 ?? 'absent'
      stored = savedDigest === '' ? undefined : savedDigest
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ moment_id: 'm-1', match_clock: '03:23', text: body.text ?? '' }),
      })
    })
    await page.route(`**/_moment-image/**`, async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from([0]) })
    })

    // Navigated inline rather than through openJournal: that helper registers
    // its own frozen /matches route, and Playwright gives the LAST
    // registration precedence — which would quietly override the mutable one
    // above and put the picture back on every refetch.
    await page.goto('/')
    await page.getByRole('tab', { name: /^Matches/ }).click()
    await page.locator('.leaf-row').first().click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()

    await page.getByRole('button', { name: /^Remove the frame/ }).click()

    // The frame goes; the words stay.
    await expect.poll(() => savedDigest).toBe('')
    await expect(page.getByRole('img', { name: /^Frame attached/ })).toHaveCount(0)
    await expect(page.getByRole('group', { name: /^Moment 1 of 1/ })).toBeVisible()
  })

  test('a dropped file that is not an image is refused where it was dropped', async ({ page }) => {
    let uploads = 0
    await page.route('**/api/v1/moment-images', async (route: Route) => {
      uploads++
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })

    await openJournal(page)
    await dropFile(page, '.cue-body', 'notes.pdf', 'application/pdf')

    await expect(page.getByRole('status').filter({ hasText: /PNG or JPEG/ })).toBeVisible()
    expect(uploads).toBe(0)
  })
})
