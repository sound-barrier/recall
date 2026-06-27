/**
 * Game-data update → a newly-added hero + map flow end-to-end.
 *
 * Simulates the user "downloading" an updated heroes.yaml / maps.yaml via the
 * game-data update — but FULLY MOCKED (no GitHub reach-out: ApplyGameDataUpdate
 * → POST /api/v1/system/data-update is stubbed). A fake support hero "Testra"
 * and a fake control map "Proving Grounds" appear only after the apply.
 *
 * Then the user hand-enters a match with the new hero/map and confirms it is
 * searchable and reflected in the dossier KPIs/Breakdowns.
 *
 * Drives: update-check modal → apply → reload → useOWData refetch →
 * ManualMatchModal (roster-sourced pickers) → POST /matches → search + dossier.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'
import { openAbout } from './_menu'

// Roster BEFORE the update — no Testra / Proving Grounds.
const BASE_ROSTER = {
  heroes_by_role: { tank: ['Reinhardt'], damage: ['Tracer'], support: ['Ana'] },
  maps_by_game_mode: { control: ['Ilios'], hybrid: ["King's Row"] },
}
// Roster AFTER the (mocked) game-data update — the fake hero + map appear.
const UPDATED_ROSTER = {
  heroes_by_role: { tank: ['Reinhardt'], damage: ['Tracer'], support: ['Ana', 'Testra'] },
  maps_by_game_mode: { control: ['Ilios', 'Proving Grounds'], hybrid: ["King's Row"] },
}

// Echo the POST'd manual match back as a stored record (normalized lowercase
// values, like the real handler), so the reload renders it.
function manualRecord(body: { map?: string; heroes?: string[]; result?: string }) {
  return {
    match_key: 'match-2026-06-15T14-30-00',
    source_files: [], source: 'manual', edited_fields: [],
    data: {
      map: body.map ?? '', hero: body.heroes?.[0] ?? '', result: body.result ?? '',
      playlist: 'competitive', date: '2026-06-15', finished_at: '14:30',
      heroes_played: (body.heroes ?? []).map((h, i) => ({ hero: h, percent_played: i === 0 ? 100 : 0, play_time: '10:00' })),
    },
  }
}

test('a game-data update adds a hero+map that flow through manual entry → search → dossier', async ({ page }) => {
  let applied = false
  let postBody: string | null = null
  const created: unknown[] = []

  // Safety net: the apply is fully mocked, so nothing should ever reach
  // GitHub. Fail loudly if it tries. (String globs, not a hostname regex.)
  let githubHit = false
  const abortGithub = (r: Route) => { githubHit = true; return r.abort() }
  await page.route('**/*github.com/**', abortGithub)
  await page.route('**/*githubusercontent.com/**', abortGithub)

  await page.route('**/api/v1/system/version', (r: Route) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: '0.3.0' }) }))

  // Update CHECK — an available game-data update carrying the fake hero/map.
  await page.route('**/api/v1/system/update', (r: Route) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      checked: true, dev_build: false, available: false, latest: '0.3.0',
      url: 'https://example.test/release/0.3.0',
      game_data: {
        commit_sha: 'def5678', applied_commit: 'abc1234', has_update: true,
        added_heroes: ['Testra'], added_maps: ['Proving Grounds'],
      },
    }) }))

  // The APPLY — mocked, NO GitHub. Flips the roster on for the next fetch.
  await page.route('**/api/v1/system/data-update', (r: Route) => {
    applied = true
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      applied_commit: 'def5678', added_heroes: ['Testra'], added_maps: ['Proving Grounds'],
    }) })
  })

  // Stateful roster: base before the apply, updated after (useOWData is a
  // one-shot-per-session singleton, so the new roster lands on reload).
  await page.route('**/api/v1/system/reference-data', (r: Route) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(applied ? UPDATED_ROSTER : BASE_ROSTER) }))

  await page.route('**/api/v1/matches', async (r: Route) => {
    const req = r.request()
    if (req.method() === 'POST') {
      postBody = req.postData()
      created.push(manualRecord(JSON.parse(postBody ?? '{}')))
      await r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(created[created.length - 1]) })
    } else {
      await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(created) })
    }
  })

  // Wide viewport → the narrow rail (with #np-search) is always visible.
  await page.setViewportSize({ width: 1500, height: 1000 })
  await page.goto('/')

  // 1) "Download" the new roster via the mocked update flow.
  await openAbout(page)
  await expect(page.locator('[data-update-check-manifest]')).toContainText(/Testra/)
  await page.locator('[data-update-check-apply]').click()
  await expect(page.locator('[data-update-check-apply]')).toContainText(/Applied/)

  // useOWData is one-shot per session → reload so the new roster is live.
  await page.reload()
  await page.locator('#tab-matches').click()

  // 2) Hand-enter a match with the new hero + map (now offered by the pickers).
  await page.locator('[data-add-match]').click()
  await expect(page.locator('.mm-modal')).toBeVisible()
  await page.locator('[data-mode="competitive"]').click()
  await page.locator('[data-queue="role"]').click()
  await page.locator('[data-role="support"]').click() // Testra is a support
  await page.locator('[data-result="victory"]').click()

  const mapCombo = page.locator('[data-combo-id="mm-map"]')
  await mapCombo.locator('.combo-input').click()
  await mapCombo.locator('.combo-input').fill('proving')
  await page.keyboard.press('Enter')
  await expect(mapCombo.locator('.combo-pill')).toContainText('proving grounds')

  const heroCombo = page.locator('[data-combo-id="mm-hero"]')
  await heroCombo.locator('.combo-input').click()
  await heroCombo.locator('.combo-list li:has-text("testra")').click()
  await expect(heroCombo.locator('.combo-pill')).toContainText('testra')
  await page.locator('#mm-title').click()

  await page.locator('[data-mm-submit]').click()
  await expect.poll(() => postBody).not.toBeNull()
  const parsed = JSON.parse(postBody as string) as { map: string; heroes: string[] }
  expect(parsed.map).toBe('proving grounds')
  expect(parsed.heroes).toEqual(['testra'])

  // Reload to a clean state — the create flow auto-opens the new match's
  // detail panel (which would inert the rail). After reload the match
  // persists via the matches GET and the roster stays updated.
  await page.reload()
  await page.locator('#tab-matches').click()

  // 3) The new match is searchable by both its hero and its map…
  await expect(page.locator('.leaf-row')).toHaveCount(1)
  await page.locator('#np-search').fill('testra')
  await expect(page.locator('.leaf-row')).toHaveCount(1)
  await page.locator('#np-search').fill('proving grounds')
  await expect(page.locator('.leaf-row')).toHaveCount(1)
  await page.locator('#np-search').fill('qqqzzz-absent')
  await expect(page.locator('.leaf-row')).toHaveCount(0)
  await page.locator('#np-search').fill('')

  // …and reflected in the default dossier breakdowns.
  await expect(page.locator('[data-widget-id="top-maps"]')).toContainText(/proving grounds/i)
  await expect(page.locator('[data-widget-id="top-heroes"]')).toContainText(/testra/i)

  // The whole flow stayed local — no GitHub.
  expect(githubHit).toBe(false)
})
