/**
 * Prometheus opt-in toggle E2E.
 *
 * The /_metrics endpoint shape is covered by Go-level tests in
 * `pkg/cmd/server_test.go` (`TestMetricsHandler_*`); the Grafana
 * panel queries land in the dashboard JSON. This spec covers the
 * remaining user-visible affordance: Settings → Advanced → Stream
 * to Grafana, the toggle that flips the server's listener on/off
 * via PUT /api/v1/settings/prometheus.
 *
 * The settings/prometheus boolean handler is the same `*bool` shape
 * pinned by `TestPrometheusEnabled_RejectsNull` — this spec proves
 * the FE sends a real bool, not `null` or omit, on both flips.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

test.describe('settings — prometheus toggle', () => {
  test('off → on → off flips fire PUT with {enabled: <bool>}', async ({ page }) => {
    let state = { enabled: false }
    const puts: Array<{ enabled: unknown }> = []

    await page.route('**/api/v1/settings/prometheus', async (route: Route) => {
      const req = route.request()
      if (req.method() === 'GET') {
        await route.fulfill({
          status:      200,
          contentType: 'application/json',
          body:        JSON.stringify(state),
        })
        return
      }
      const body = JSON.parse(req.postData() ?? '{}') as { enabled: unknown }
      puts.push(body)
      if (typeof body.enabled !== 'boolean') {
        // Mirror the server's TestPrometheusEnabled_RejectsNull
        // contract — null/missing/non-bool is a 400. If the FE
        // ever regressed to omitting the field this would surface
        // here.
        await route.fulfill({ status: 400, body: 'enabled must be bool' })
        return
      }
      state = { enabled: body.enabled }
      await route.fulfill({ status: 204, body: '' })
    })

    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status:      200,
        contentType: 'application/json',
        body:        '[]',
      })
    })

    await page.goto('/')
    await page.locator('#tab-settings').click()

    // Advanced section is a <details> closed by default. Open it.
    // `#sec-advanced summary` matches nested <details><summary> too
    // (Supported-formats row); scope to the outer .advanced-summary.
    const advanced = page.locator('#sec-advanced')
    await advanced.scrollIntoViewIfNeeded()
    await advanced.locator('summary.advanced-summary').click()
    await expect(advanced).toHaveAttribute('open', '')

    const toggle = advanced.locator('.big-switch').first()
    await expect(toggle.locator('.big-switch-state')).toHaveText('Off')

    // Off → On.
    await toggle.click()
    await expect.poll(() => puts.length).toBe(1)
    expect(puts[0]).toEqual({ enabled: true })
    await expect(toggle.locator('.big-switch-state')).toHaveText('Live')

    // On → Off. Confirms the FE re-derives from server state and
    // sends a real `false`, not omits the field.
    await toggle.click()
    await expect.poll(() => puts.length).toBe(2)
    expect(puts[1]).toEqual({ enabled: false })
    await expect(toggle.locator('.big-switch-state')).toHaveText('Off')
  })
})
