/**
 * Hand-entering a match (no OCR) — the no-Tesseract persona.
 *
 * Starting from an EMPTY match list, the toolbar's "Add match" button opens
 * the modal; the map + hero pickers are the Filter-matches FilterCombobox
 * (searchable, lowercase), the rest are chip toggles. Saving POSTs
 * ManualMatchInput to /api/v1/matches (201), the app reloads, and the new
 * match appears with the Manual badge.
 *
 * Drives api.ts ↔ POST /api/v1/matches ↔ Go ↔ store ↔ aggregate.
 */
import { test, expect } from './_fixtures'
import type { Route } from '@playwright/test'

// The combobox options come from useOWData; the picked VALUES are the
// normalized lowercase forms (mapIndex / heroIndex keys), so "Ilios" → "ilios".
const refData = {
  heroes_by_role: { tank: ['Reinhardt'], damage: ['Tracer'], support: ['Ana'] },
  maps_by_game_mode: { control: ['Ilios'], hybrid: ["King's Row"] },
}

function manualRecord(body: { map?: string; heroes?: string[]; result?: string; play_mode?: string; queue_type?: string }) {
  return {
    match_key: 'match-2026-06-15T14-30-00',
    source_files: [],
    source: 'manual',
    edited_fields: [],
    data: {
      map: body.map ?? '',
      hero: body.heroes?.[0] ?? '',
      result: body.result ?? '',
      heroes_played: (body.heroes ?? []).map((h, i) => ({ hero: h, percent_played: i === 0 ? 100 : 0 })),
    },
    play_mode: body.play_mode,
    queue_type: body.queue_type,
  }
}

test('Add match → fill → save → the match appears with the Manual badge', async ({ page }) => {
  let postBody: string | null = null
  const created: unknown[] = []
  await page.route('**/api/v1/system/reference-data', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(refData) }),
  )
  await page.route('**/api/v1/matches', async (route: Route) => {
    const req = route.request()
    if (req.method() === 'POST') {
      postBody = req.postData()
      const rec = manualRecord(JSON.parse(postBody ?? '{}'))
      created.push(rec)
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(rec) })
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(created) })
    }
  })

  await page.goto('/')
  await page.locator('#tab-matches').click()

  await page.locator('[data-add-match]').click()
  await expect(page.locator('.mm-modal')).toBeVisible()

  // Esc inside a text field deselects it — it must NOT tear down the modal.
  await page.locator('[data-combo-id="mm-map"] .combo-input').click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.mm-modal')).toBeVisible()

  // Toggles first, while no dropdown is open to overlap them.
  await page.locator('[data-mode="competitive"]').click()
  await page.locator('[data-queue="role"]').click()
  // Role queue is single-role: a role is required and constrains the hero
  // list. Ana is a support, so pick support to surface her.
  await page.locator('[data-role="support"]').click()
  await page.locator('[data-result="victory"]').click()
  await page.locator('[data-leaver="team"]').click()

  // Map — single-select via Tab-to-complete: type, Tab highlights the match,
  // Enter selects it (the single-select picker then auto-closes). Tab must NOT
  // leave the field while the dropdown is open.
  const mapCombo = page.locator('[data-combo-id="mm-map"]')
  await mapCombo.locator('.combo-input').click()
  await mapCombo.locator('.combo-input').fill('ili')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await expect(mapCombo.locator('.combo-pill')).toContainText('ilios')

  // Hero — same picker; first selected is the primary.
  const heroCombo = page.locator('[data-combo-id="mm-hero"]')
  await heroCombo.locator('.combo-input').click()
  await heroCombo.locator('.combo-list li:has-text("ana")').click()
  await expect(heroCombo.locator('.combo-pill')).toContainText('ana')
  await page.locator('#mm-title').click()

  await page.locator('[data-mm-submit]').click()

  await expect.poll(() => postBody).not.toBeNull()
  const parsed = JSON.parse(postBody as string) as {
    map: string; play_mode: string; queue_type: string; heroes: string[]; result: string; leaver: string
  }
  expect(parsed.map).toBe('ilios')
  expect(parsed.play_mode).toBe('competitive')
  expect(parsed.queue_type).toBe('role')
  expect(parsed.heroes).toEqual(['ana'])
  expect(parsed.result).toBe('victory')
  expect(parsed.leaver).toBe('team')

  // The created manual match surfaces with the Manual provenance badge.
  await expect(page.locator('.prov-manual').first()).toBeVisible()
})

test('role queue requires a single role and constrains the hero list', async ({ page }) => {
  await page.route('**/api/v1/system/reference-data', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(refData) }),
  )
  await page.route('**/api/v1/matches', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
  )

  await page.goto('/')
  await page.locator('#tab-matches').click()
  await page.locator('[data-add-match]').click()
  await expect(page.locator('.mm-modal')).toBeVisible()

  // Role queue → role is now a required field, surfaced in the footer hint.
  await page.locator('[data-mode="competitive"]').click()
  await page.locator('[data-queue="role"]').click()
  await expect(page.locator('.mm-foot-status')).toContainText('role')

  // Before a role is picked there are no selectable heroes — no cross-role
  // mixing — and the picker nudges the user to choose a role first.
  const heroCombo = page.locator('[data-combo-id="mm-hero"]')
  await heroCombo.locator('.combo-input').click()
  await expect(heroCombo.locator('.combo-list li[role="option"]')).toHaveCount(0)
  await expect(heroCombo.locator('.combo-empty')).toContainText(/pick a role/i)

  // Pick the tank role → only the tank (Reinhardt) is offered; the support
  // (Ana) and damage (Tracer) heroes are filtered out entirely.
  await page.locator('[data-role="tank"]').click()
  await heroCombo.locator('.combo-input').click()
  await expect(heroCombo.locator('.combo-list li[role="option"]')).toHaveCount(1)
  await expect(heroCombo.locator('.combo-list li[role="option"]')).toContainText('reinhardt')

  // Selecting reinhardt, then switching the role to support, drops the
  // now-illegal tank pick — the selection can never span two roles.
  await heroCombo.locator('.combo-list li:has-text("reinhardt")').click()
  await expect(heroCombo.locator('.combo-pill')).toContainText('reinhardt')
  await page.locator('[data-role="support"]').click()
  await expect(heroCombo.locator('.combo-pill')).toHaveCount(0)
})
