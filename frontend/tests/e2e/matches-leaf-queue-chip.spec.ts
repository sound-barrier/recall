/**
 * Matches leaf row — queue-type chip next to the play-mode chip.
 *
 * Pre-this-feature the leaf row showed `data.playlist` (raw OCR
 * quickplay/competitive) as a single chip and silently dropped
 * the chip when the field was empty — the user had no signal that
 * the queue type was unset, even though that's the second pivot
 * (role-queue vs open-queue) the dossier slices on.
 *
 * Contract: every row renders TWO chips side-by-side under the
 * map name. The first reflects play mode (Quickplay / Competitive
 * / Unknown mode), the second reflects queue type (Role Queue /
 * Open Queue / Unknown mode type). Both fall back to the Unknown
 * label when the underlying field is missing, so the row never
 * has fewer chips than its neighbour — a glance down the column
 * stays aligned.
 *
 * The play-mode chip prefers the user-override `play_mode` (set
 * via the right-panel chooser) and falls back to the OCR-derived
 * `data.playlist` when the override is missing — same fallback chain
 * the play-mode filter chip uses.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

type Match = {
  match_key: string
  source_files: string[]
  source_types: Record<string, string>
  play_mode?: 'quickplay' | 'competitive'
  queue_type?: 'role' | 'open'
  data: Record<string, unknown>
  parsed_at: string
}

function rec(
  matchKey: string,
  opts: { playMode?: 'quickplay' | 'competitive'; queueType?: 'role' | 'open'; dataMode?: string },
): Match {
  const m: Match = {
    match_key:    matchKey,
    source_files: [`${matchKey}.png`],
    source_types: { [`${matchKey}.png`]: 'summary' },
    data: {
      map:           'rialto',
      type:          'control',
      hero:          'lucio',
      result:        'victory',
      date:          '2026-05-10',
      finished_at:   '22:00',
      eliminations:  10,
      assists:       5,
      deaths:        3,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '5:00' }],
    },
    parsed_at: '2026-05-10T22:30:00Z',
  }
  if (opts.dataMode) (m.data as Record<string, unknown>).playlist = opts.dataMode
  if (opts.playMode) m.play_mode = opts.playMode
  if (opts.queueType) m.queue_type = opts.queueType
  return m
}

test.describe('Matches — leaf row queue-type chip', () => {
  test('renders both chips with sensible Unknown fallbacks', async ({ page }) => {
    // Four rows exercise the matrix:
    //   r1 = both set (override + queue)        → Competitive / Role Queue
    //   r2 = play_mode missing, OCR competitive → Competitive / Open Queue
    //   r3 = play_mode missing, no OCR mode     → Unknown mode / Open Queue
    //   r4 = nothing set anywhere               → Unknown mode / Unknown mode type
    const matches = [
      rec('r1', { playMode: 'competitive', queueType: 'role', dataMode: 'competitive' }),
      rec('r2', { queueType: 'open', dataMode: 'competitive' }),
      rec('r3', { queueType: 'open' }),
      rec('r4', {}),
    ]
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(matches),
      })
    })
    await page.goto('/')
    await expect(page.locator('#panel-matches')).toBeVisible()

    const modeChips  = await page.locator('.leaf-mode-chip').allTextContents()
    const queueChips = await page.locator('.leaf-queue-chip').allTextContents()
    expect(modeChips).toEqual([
      'Competitive',
      'Competitive',
      'Unknown mode',
      'Unknown mode',
    ])
    expect(queueChips).toEqual([
      'Role Queue',
      'Open Queue',
      'Open Queue',
      'Unknown mode type',
    ])
  })

  test('mode chip prefers user override over OCR data.playlist', async ({ page }) => {
    // Override says quickplay, OCR says competitive — override wins.
    const matches = [rec('only', {
      playMode: 'quickplay', queueType: 'role', dataMode: 'competitive',
    })]
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(matches),
      })
    })
    await page.goto('/')
    await expect(page.locator('#panel-matches')).toBeVisible()
    await expect(page.locator('.leaf-mode-chip').first()).toHaveText('Quickplay')
    await expect(page.locator('.leaf-queue-chip').first()).toHaveText('Role Queue')
  })
})
