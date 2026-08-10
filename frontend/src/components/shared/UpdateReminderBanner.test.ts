import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { createPinia, setActivePinia } from 'pinia'

import UpdateReminderBanner from '@/components/shared/UpdateReminderBanner.vue'
import { useAppStore } from '@/stores/app'
import type { UpdateInfo } from '@/api'
import { qk } from '@/queries/keys'
import { seedQuery } from '@/test-utils/queryTestUtils'

// The banner now owns the whole reminder feature (useUpdateReminder derives the
// gate + day-count from the app store's updateInfo), so these seed updateInfo —
// the raw input — and assert the rendered result, rather than passing the
// already-derived open/days props.
const DAY = 24 * 60 * 60 * 1000
const isoDaysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString()

function renderWith(last_checked_at: string) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const appStore = useAppStore()
  seedQuery(qk.system.update, { checked: true, current: '1.0.0', latest: '1.0.0', last_checked_at } as unknown as UpdateInfo)
  // Spy before render — the component destructures openAbout at setup. "Check
  // now" opens About (the update hub), which runs the check.
  const checkSpy = vi.spyOn(appStore, 'openAbout').mockImplementation(() => {})
  const view = render(UpdateReminderBanner, { global: { plugins: [pinia] } })
  return { view, appStore, checkSpy }
}

describe('UpdateReminderBanner', () => {
  beforeEach(() => { globalThis.localStorage?.clear() })

  it('renders the "Last checked N days ago" copy when the last check is 90+ days old', () => {
    renderWith(isoDaysAgo(92))
    expect(screen.getByText(/Last checked 92 days ago/)).toBeInTheDocument()
  })

  it('renders the "never checked" copy when last_checked_at is unset', () => {
    renderWith('')
    expect(screen.getByText(/haven't checked/)).toBeInTheDocument()
  })

  it('opens About (the update hub) when "Check now" is clicked', async () => {
    const user = userEvent.setup()
    const { checkSpy } = renderWith(isoDaysAgo(100))
    await user.click(screen.getByRole('button', { name: 'Check now' }))
    expect(checkSpy).toHaveBeenCalledOnce()
  })

  it('hides itself once the × dismiss is clicked', async () => {
    const user = userEvent.setup()
    renderWith(isoDaysAgo(100))
    expect(screen.getByRole('status')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Dismiss update reminder' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('stays hidden when the last check is within the 90-day window', () => {
    renderWith(isoDaysAgo(10))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
