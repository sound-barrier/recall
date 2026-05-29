/**
 * Detail-panel keyboard ergonomics E2E.
 *
 * Drives the post-eval keybindings from the user's review:
 *
 *   ← / → → previous / next match (timeline metaphor)
 *   ↑ / ↓ → scroll panel body, NOT the page behind
 *   /     → focuses the match-search input; while the panel is open
 *           AND the search has any clauses, the panel selection
 *           tracks the first hit as the user types
 *   Enter in search (panel closed) → opens first hit in the panel
 */
import { test, expect } from './_fixtures'
import type { Route } from '@playwright/test'

function record(matchKey: string, opts: { note?: string; result?: string; finishedAt?: string; withRank?: boolean; finalScore?: string } = {}) {
  return {
    match_key: matchKey,
    source_files: [`${matchKey}.png`],
    source_types: { [`${matchKey}.png`]: 'summary' },
    data: {
      map: 'rialto', mode: 'competitive', type: 'control', role: 'support', hero: 'lucio',
      result: opts.result ?? 'victory',
      date: '2026-05-10', finished_at: opts.finishedAt ?? '22:00',
      eliminations: 17, assists: 16, deaths: 11, damage: 7200,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:25' }],
      final_score: opts.finalScore ?? '3-2',
      ...(opts.withRank ? { rank: 'diamond', level: '3', rank_progress: 42, change_percent: 24 } : {}),
    },
    parsed_at: `2026-05-10T${(opts.finishedAt ?? '22:30').slice(0, 2)}:30:00Z`,
    ...(opts.note ? { annotation: { note: opts.note } } : {}),
  }
}

// All on the same day so the Month→Week→Day grouping keeps every
// card visible; finished_at orders them within the day.
const CORPUS = [
  record('m1', { note: 'huge clutch second point', finishedAt: '22:00', withRank: true }),
  record('m2', { result: 'defeat', finishedAt: '21:00' }),
  record('m3', { result: 'draw',   finishedAt: '20:00' }),
]

test.describe('match detail panel — keyboard ergonomics', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CORPUS) })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.leaf-row')).toHaveCount(3)
  })

  test('→ paginates to the next match; ← to the previous', async ({ page }) => {
    await page.locator('.leaf-row').first().click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()
    // Position chip starts at "1 of 3" because newest-first sort puts
    // m1 (May 10) at the top.
    await expect(page.locator('.detail-pos strong')).toHaveText('1')

    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.detail-pos strong')).toHaveText('2')

    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.detail-pos strong')).toHaveText('3')

    // At the end, → is a no-op.
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.detail-pos strong')).toHaveText('3')

    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('.detail-pos strong')).toHaveText('2')
  })

  test('↑ / ↓ scrolls the panel body, the page behind stays put', async ({ page }) => {
    await page.locator('.leaf-row').first().click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()

    const initialWindowScroll = await page.evaluate(() => window.scrollY)

    // ↓ a few times — the panel body should scroll, not the window.
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('ArrowDown')
    }

    const afterWindowScroll = await page.evaluate(() => window.scrollY)
    expect(afterWindowScroll).toBe(initialWindowScroll)

    // Panel body scrolled — pin via the inner scroll position.
    // `scroll-behavior: smooth` makes each scrollBy() animate, so
    // scrollTop ramps up over a couple of animation frames after
    // each keypress. Poll until the cumulative scroll has landed.
    await page.waitForFunction(() => {
      const el = document.querySelector('.detail-body') as HTMLElement | null
      return !!el && el.scrollTop > 0
    }, { timeout: 2000 })
    const panelScroll = await page.evaluate(() => {
      const el = document.querySelector('.detail-body')
      return el ? (el as HTMLElement).scrollTop : -1
    })
    expect(panelScroll).toBeGreaterThan(0)
  })

  test('/ is a no-op while the panel is open — focus stays inside the panel', async ({ page }) => {
    // Open the panel on m2.
    await page.locator('.leaf-row').nth(1).click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()

    // Panel-open contract: every keyboard action stays inside the
    // panel. `/` would normally focus the FilterRail match-search
    // input, which lives OUTSIDE the panel — so it should be
    // suppressed while the panel is open.
    await page.keyboard.press('/')

    const insidePanel = await page.evaluate(() => {
      const panel = document.querySelector('aside.detail-panel')
      const active = document.activeElement
      return !!panel && !!active && panel.contains(active)
    })
    expect(insidePanel).toBe(true)

    // And specifically NOT on the match-search input.
    const onSearch = await page.evaluate(() => document.activeElement?.id === 'match-search')
    expect(onSearch).toBe(false)
  })

  test('background sections behind an open panel are inert (no focusable leaks)', async ({ page }) => {
    await page.locator('.leaf-row').first().click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()

    // The masthead, nav, FilterRail and matches list all live inside
    // a single `.container` wrapper. When the panel is open that
    // wrapper carries `inert` so its descendants are not focusable
    // (defense in depth on top of the focus trap — Tab order can't
    // even reach them, and click-to-focus on background text is
    // suppressed). ParseStatusBar lives outside `.container` so it
    // carries its own `inert` flag in the same situation.
    const inertOnContainer = await page.evaluate(() => {
      const c = document.querySelector('.container') as HTMLElement | null
      return c?.hasAttribute('inert') ?? false
    })
    expect(inertOnContainer).toBe(true)

    // Specifically, the match-search input — the most obvious leak
    // path — must not be focusable while the panel is up.
    const searchInputFocusable = await page.evaluate(() => {
      const input = document.getElementById('match-search') as HTMLInputElement | null
      if (!input) return false
      input.focus()
      return document.activeElement === input
    })
    expect(searchInputFocusable).toBe(false)
  })

  test('Tab cycles focusable elements within the panel — no escape to background', async ({ page }) => {
    await page.locator('.leaf-row').first().click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()

    // After open, focus lands on the close button (markup-first
    // focusable inside the panel).
    let onCloseBtn = await page.evaluate(() => document.activeElement?.classList.contains('detail-close'))
    expect(onCloseBtn).toBe(true)

    // Tab forward many times. Every focused element should stay
    // inside the panel — if Tab leaked to FilterRail / nav / etc,
    // this would fail.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab')
      const inside = await page.evaluate(() => {
        const panel = document.querySelector('aside.detail-panel')
        const active = document.activeElement
        return !!panel && !!active && panel.contains(active)
      })
      expect(inside, `Tab #${i + 1} escaped the panel`).toBe(true)
    }

    // Shift+Tab walks backwards; same containment contract.
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Shift+Tab')
      const inside = await page.evaluate(() => {
        const panel = document.querySelector('aside.detail-panel')
        const active = document.activeElement
        return !!panel && !!active && panel.contains(active)
      })
      expect(inside, `Shift+Tab #${i + 1} escaped the panel`).toBe(true)
    }

    // Cycling forward enough should eventually land back on the
    // close button (proving the trap WRAPS rather than just stops).
    let wrappedToClose = false
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab')
      const onClose = await page.evaluate(() => document.activeElement?.classList.contains('detail-close'))
      if (onClose) { wrappedToClose = true; break }
    }
    expect(wrappedToClose).toBe(true)
  })

  // Removed: "Enter in match-search opens the first hit" — the old
  // FilterRail had a global search input where Enter would open the
  // panel to the first matched row. The new narrow-panel design
  // routes / to the consolidated panel's search box and Enter has
  // no special open-first-hit semantic. Revisit if user requests it.

  test('panel body sections appear in the documented order', async ({ page }) => {
    // m1 has rank data, an annotation, and a final score — the only
    // match in the corpus that exercises every section, so we open
    // it to compare the rendered order against the contract.
    await page.locator('.leaf-row').first().click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()

    // Top-of-panel meta strip: date + final score. Rendered as its
    // own block right under the toolbar, NOT buried below the stats.
    await expect(page.locator('.detail-body .detail-meta-strip').first()).toBeVisible()

    // Walk the panel body and read each top-level child's selector
    // signature. We assert the ORDER of major sections:
    //   1. .detail-meta-strip  (date + final score)
    //   2. .leaver-chooser     (Leaver? scenario chips)
    //   3. .stats              (Match Stats grid)
    //   4. .rank-block         (rank — only when present; bumped
    //                           above the journal so the milestone
    //                           sits next to the stats it just
    //                           contextualised)
    //   5. .match-journal      (note / replay / squad / tags)
    //   6. .heroes-played      (Heroes Played list)
    //   7. .sources-block      (Source Screenshots)
    const order = await page.evaluate(() => {
      const body = document.querySelector('.detail-body')
      if (!body) return []
      const interesting = ['detail-meta-strip', 'match-journal', 'leaver-chooser', 'stats', 'rank-block', 'heroes-played', 'sources-block']
      const out: string[] = []
      const seen = new Set<string>()
      const walker = body.querySelectorAll('*')
      for (const el of Array.from(walker)) {
        for (const cls of interesting) {
          if (el.classList.contains(cls) && !seen.has(cls)) {
            seen.add(cls)
            out.push(cls)
          }
        }
      }
      return out
    })
    expect(order).toEqual([
      'detail-meta-strip',
      'leaver-chooser',
      'stats',
      'rank-block',
      'match-journal',
      'heroes-played',
      'sources-block',
    ])

    // Stats block carries a "Match Stats" eyebrow now (it used to be
    // unlabeled). User-facing label so the section reads as a card
    // header, not a free-floating digits row.
    await expect(page.locator('.match-stats-block .block-eyebrow')).toHaveText(/match stats/i)

    // Rank block is decorated as a rare/important section. We assert
    // the marker class — a non-default visual treatment that signals
    // "this match included a rank update."
    await expect(page.locator('.rank-block.rare')).toBeVisible()
  })

  test('Escape inside a text field blurs the field — does NOT close the panel', async ({ page }) => {
    await page.locator('.leaf-row').first().click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()

    // Focus a real input inside the journal — the replay-code field
    // is always an <input> regardless of annotation state, so it's
    // the most reliable handle.
    const replayInput = page.locator('input.match-notes-input.mono').first()
    await replayInput.focus()
    await expect(replayInput).toBeFocused()

    // Sanity: typing works (proves we're inside the editable).
    await page.keyboard.type('ABC123')
    await expect(replayInput).toHaveValue('ABC123')

    // Escape should blur the input but keep the panel open. Without
    // a guard, useModalFocusTrap's document-level keydown would
    // intercept Escape and emit close — surfacing as "I hit Esc to
    // dismiss the textarea and the whole panel went away."
    //
    // Wait past the panel's slide-out transition (260ms) before
    // re-checking visibility — otherwise a buggy implementation
    // that DOES close the panel passes here just because the exit
    // animation hasn't completed yet.
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    await expect(page.locator('aside.detail-panel')).toBeVisible()
    await expect(replayInput).not.toBeFocused()

    // A SECOND Escape — now that focus is no longer in an editable
    // — should close the panel (preserves the global "Esc dismisses
    // modal" contract).
    await page.keyboard.press('Escape')
    await expect(page.locator('aside.detail-panel')).toHaveCount(0)
  })

  test('clicking a source-preview image opens a fullscreen lightbox; Esc / × close it without closing the panel', async ({ page }) => {
    // Stub the screenshot endpoint with a tiny valid PNG so the
    // <img> loads (previewError doesn't get set, the click target
    // is rendered).
    await page.route('**/_screenshot/**', async (route) => {
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      )
      await route.fulfill({ status: 200, contentType: 'image/png', body: png })
    })

    await page.locator('.leaf-row').first().click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()

    // Expand the sources block; click the source row to flip its
    // inline preview on. `.sources-toggle` includes slot-chip
    // buttons with `@click.stop`, and Playwright's default click
    // lands on the geometric center — which sometimes hits one of
    // those chips and never bubbles to the toggle handler. Click
    // the static label child instead to dodge the chip strip.
    await page.locator('.sources-toggle .sources-label').click()
    await page.locator('.source-name').first().click()
    const previewImg = page.locator('img.source-preview').first()
    await expect(previewImg).toBeVisible()

    // Click the inline preview → fullscreen lightbox over the
    // whole window.
    await previewImg.click()
    const lightbox = page.locator('.lightbox-backdrop')
    await expect(lightbox).toBeVisible()
    await expect(lightbox.locator('img.lightbox-img')).toBeVisible()
    await expect(lightbox.locator('.lightbox-close')).toBeVisible()

    // Esc dismisses the lightbox but NOT the panel beneath. Wait
    // past both transitions (lightbox fade + would-be panel slide)
    // before asserting, so a buggy implementation that closes both
    // can't pass on race timing.
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    await expect(page.locator('.lightbox-backdrop')).toHaveCount(0)
    await expect(page.locator('aside.detail-panel')).toBeVisible()

    // Re-open + × button closes too.
    await previewImg.click()
    await expect(page.locator('.lightbox-backdrop')).toBeVisible()
    await page.locator('.lightbox-close').click()
    await expect(page.locator('.lightbox-backdrop')).toHaveCount(0)
    await expect(page.locator('aside.detail-panel')).toBeVisible()
  })

  test('? cheatsheet over an open panel: shows panel-scoped section, Esc closes only the cheatsheet', async ({ page }) => {
    await page.locator('.leaf-row').first().click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()

    // Open the cheatsheet with `?` (no Shift+/ keys needed —
    // useKeyboardShortcuts maps the `?` key directly).
    await page.keyboard.press('?')
    const cheatsheet = page.locator('[data-testid="kbd-shortcuts-modal"]')
    await expect(cheatsheet).toBeVisible()

    // Group headings inside the cheatsheet — when the panel is up,
    // we want to see Global, Detail panel, Tablist + modals; the
    // Matches-view group is irrelevant here (j / k focus cards in
    // the matches list, which is inert while the panel is open).
    const groupTitles = await cheatsheet.locator('.kbd-group-title').allTextContents()
    expect(groupTitles).toContain('Global')
    expect(groupTitles).toContain('Detail panel')
    expect(groupTitles).not.toContain('Matches view')

    // Esc dismisses the cheatsheet only. Wait past the panel's
    // 260 ms slide-out transition so a buggy implementation that
    // also closes the panel can't sneak by on race timing.
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    await expect(cheatsheet).toHaveCount(0)
    await expect(page.locator('aside.detail-panel')).toBeVisible()
  })

  test('cheatsheet: j / ↑ scroll up, k / ↓ scroll down, every other key is a no-op except Esc', async ({ page }) => {
    // Force cheatsheet content to overflow by shrinking the viewport.
    await page.setViewportSize({ width: 800, height: 400 })

    await page.locator('.leaf-row').first().click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()

    await page.keyboard.press('?')
    const cheatsheet = page.locator('[data-testid="kbd-shortcuts-modal"]')
    await expect(cheatsheet).toBeVisible()

    // ↓ scrolls the modal body down.
    for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowDown')
    await page.waitForFunction(() => {
      const el = document.querySelector('.kbd-modal-box') as HTMLElement | null
      return !!el && el.scrollTop > 0
    }, { timeout: 2000 })
    const downScroll = await page.evaluate(() => {
      const el = document.querySelector('.kbd-modal-box') as HTMLElement | null
      return el ? el.scrollTop : -1
    })
    expect(downScroll).toBeGreaterThan(0)

    // 'k' continues scrolling down.
    for (let i = 0; i < 4; i++) await page.keyboard.press('k')
    await page.waitForFunction((prev) => {
      const el = document.querySelector('.kbd-modal-box') as HTMLElement | null
      return !!el && el.scrollTop > prev
    }, downScroll, { timeout: 2000 })

    // ↑ scrolls back up (eventually toward 0).
    for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowUp')
    await page.waitForFunction(() => {
      const el = document.querySelector('.kbd-modal-box') as HTMLElement | null
      return !!el && el.scrollTop < 5
    }, { timeout: 2000 })

    // 'g' then 'm' is a no-op while the cheatsheet is up — without
    // the modal swallowing the keys, this would navigate to Matches
    // view (here we're already on Matches, so we'd ALSO close the
    // cheatsheet via the view change). Asserting the cheatsheet
    // stays open is the simplest pin.
    await page.keyboard.press('g')
    await page.keyboard.press('s')
    await page.waitForTimeout(150)
    await expect(cheatsheet).toBeVisible()
    // And underlying view didn't change.
    const onMatchesTab = await page.locator('#tab-matches[aria-selected="true"]').count()
    expect(onMatchesTab).toBe(1)

    // '/' would normally focus the match-search input — should also
    // be swallowed.
    await page.keyboard.press('/')
    await page.waitForTimeout(150)
    await expect(cheatsheet).toBeVisible()
    const searchFocused = await page.evaluate(() => document.activeElement?.id === 'match-search')
    expect(searchFocused).toBe(false)

    // Esc closes only the cheatsheet (panel stays open).
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    await expect(cheatsheet).toHaveCount(0)
    await expect(page.locator('aside.detail-panel')).toBeVisible()
  })

  test('Heroes Played starts expanded for every match, even after a collapse on a sibling', async ({ page }) => {
    await page.locator('.leaf-row').first().click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()

    // First match: heroes-played panel is open by default.
    const heroesItems = page.locator('.heroes-played-items')
    await expect(heroesItems).toBeVisible()
    await expect(page.locator('.heroes-played-toggle')).toHaveAttribute('aria-expanded', 'true')

    // User collapses it on this card.
    await page.locator('.heroes-played-toggle').click()
    await expect(heroesItems).toHaveCount(0)
    await expect(page.locator('.heroes-played-toggle')).toHaveAttribute('aria-expanded', 'false')

    // Paginate to the next match — the new card should auto-expand
    // the section again so the user lands on full context, not on
    // the collapsed summary they were just on.
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.detail-pos strong')).toHaveText('2')
    await expect(page.locator('.heroes-played-items')).toBeVisible()
    await expect(page.locator('.heroes-played-toggle')).toHaveAttribute('aria-expanded', 'true')
  })
})

test.describe('match detail panel — contract: auto-close + click-outside', () => {
  // These specs each set up their own mocks because the auto-close
  // tests need to flip the matches list mid-test (Hide flow) and the
  // click-outside tests don't share the rank fixture with the keyboard
  // ergonomics describe block.

  test('hiding the open match auto-closes the panel', async ({ page }) => {
    const KEY_ENCODED = encodeURIComponent('m1')
    let hidden = false
    function rec() {
      return {
        match_key: 'm1',
        source_files: ['m1.png'],
        source_types: { 'm1.png': 'summary' },
        data: { map: 'rialto', mode: 'competitive', type: 'control', role: 'support', hero: 'lucio', result: 'victory', date: '2026-05-10', finished_at: '22:00' },
        parsed_at: '2026-05-10T22:30:00Z',
        hidden,
      }
    }
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([rec()]) })
    })
    await page.route(`**/api/v1/matches/${KEY_ENCODED}/visibility`, async (route: Route) => {
      const body = JSON.parse(route.request().postData() ?? '{}')
      hidden = !!body.hidden
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.leaf-row').first().click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()

    // Hide → Confirm; the match leaves filteredSorted on the
    // next /api/v1/matches refresh, and useSelectedMatch's auto-close
    // watch fires.
    await page.locator('.danger-btn', { hasText: 'Hide match' }).click()
    await page.locator('.danger-btn', { hasText: 'Confirm' }).click()

    // Panel disappears.
    await expect(page.locator('aside.detail-panel')).toHaveCount(0)
  })

  test('click on the dim backdrop closes the panel', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{
          match_key: 'm1',
          source_files: ['m1.png'],
          source_types: { 'm1.png': 'summary' },
          data: { map: 'rialto', mode: 'competitive', type: 'control', role: 'support', hero: 'lucio', result: 'victory', date: '2026-05-10', finished_at: '22:00' },
          parsed_at: '2026-05-10T22:30:00Z',
        }]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.leaf-row').first().click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()

    // Click on the backdrop at a coordinate that's outside the
    // 540px-wide panel (panel anchors right; click far-left of
    // viewport).
    await page.locator('.detail-backdrop').click({ position: { x: 20, y: 200 } })
    await expect(page.locator('aside.detail-panel')).toHaveCount(0)
  })

  test('? on a non-Matches view shows only Global + Tablist (no Matches / Detail-panel sections)', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    await page.goto('/')
    // Navigate to Settings via the tab — panel + matches groups
    // should drop out of the rendered cheatsheet.
    await page.locator('#tab-settings').click()
    await page.keyboard.press('?')
    const cheatsheet = page.locator('[data-testid="kbd-shortcuts-modal"]')
    await expect(cheatsheet).toBeVisible()

    const titles = await cheatsheet.locator('.kbd-group-title').allTextContents()
    expect(titles).toContain('Global')
    expect(titles).toContain('Tablist + modals')
    expect(titles).not.toContain('Matches view')
    expect(titles).not.toContain('Detail panel')
  })

  test('cheatsheet backdrop click closes the modal', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.keyboard.press('?')
    const cheatsheet = page.locator('[data-testid="kbd-shortcuts-modal"]')
    await expect(cheatsheet).toBeVisible()

    // The overlay is the cheatsheet's outermost element; the modal
    // box stops propagation on its own click. Tap the overlay near
    // a corner so we miss the centered box.
    await cheatsheet.click({ position: { x: 10, y: 10 } })
    await expect(cheatsheet).toHaveCount(0)
  })

  test('lightbox backdrop click closes the lightbox (panel stays)', async ({ page }) => {
    await page.route('**/_screenshot/**', async (route) => {
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      )
      await route.fulfill({ status: 200, contentType: 'image/png', body: png })
    })
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{
          match_key: 'm1',
          source_files: ['m1.png'],
          source_types: { 'm1.png': 'summary' },
          data: { map: 'rialto', mode: 'competitive', type: 'control', role: 'support', hero: 'lucio', result: 'victory', date: '2026-05-10', finished_at: '22:00' },
          parsed_at: '2026-05-10T22:30:00Z',
        }]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.leaf-row').first().click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()

    await page.locator('.sources-toggle .sources-label').click()
    await page.locator('.source-name').first().click()
    await page.locator('img.source-preview').first().click()
    await expect(page.locator('.lightbox-backdrop')).toBeVisible()

    // Click the backdrop at the top-right (away from the centered
    // image AND the top-left × button).
    await page.locator('.lightbox-backdrop').click({ position: { x: 780, y: 20 } })
    await expect(page.locator('.lightbox-backdrop')).toHaveCount(0)
    // Panel still up.
    await expect(page.locator('aside.detail-panel')).toBeVisible()
  })
})
