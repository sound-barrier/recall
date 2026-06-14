import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h, ref, type Ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { useUpdateReminder, UPDATE_REMINDER_DISMISSED_KEY } from '@/composables/shared/useUpdateReminder'
import type { UpdateInfo } from '@/api'

const NOW = Date.UTC(2026, 5, 8) // 2026-06-08
const DAYS = 24 * 60 * 60 * 1000

let storage: Record<string, string>

function infoWithLastChecked(daysAgo: number | null): UpdateInfo {
  const last_checked_at = daysAgo === null ? undefined : new Date(NOW - daysAgo * DAYS).toISOString()
  return {
    checked: true,
    dev_build: false,
    available: false,
    latest: '1.2.3',
    url: 'https://example/v1.2.3',
    game_data: { commit_sha: '', applied_commit: '', has_update: false },
    ...(last_checked_at ? { last_checked_at } : {}),
  }
}

// mountWith runs the composable inside a real Vue setup() context so
// the onBeforeUnmount listener registration in usePersistedRef has a
// component instance to bind to.
function mountWith(info: Ref<UpdateInfo | null>, now: () => number) {
  let api!: ReturnType<typeof useUpdateReminder>
  const Comp = defineComponent({
    setup() {
      api = useUpdateReminder(info, now)
      return () => h('div')
    },
  })
  mount(Comp)
  return api
}

describe('useUpdateReminder', () => {
  beforeEach(() => {
    storage = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => { storage[key] = value },
    })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('hides while updateInfo is null (first paint)', async () => {
    const info = ref<UpdateInfo | null>(null)
    const { shouldShowBanner } = mountWith(info, () => NOW)
    await flushPromises()
    expect(shouldShowBanner.value).toBe(false)
  })

  it('shows when last_checked_at is missing and never dismissed', async () => {
    const info = ref<UpdateInfo | null>(infoWithLastChecked(null))
    const { shouldShowBanner } = mountWith(info, () => NOW)
    await flushPromises()
    expect(shouldShowBanner.value).toBe(true)
  })

  it('shows when last_checked_at is older than 90 days', async () => {
    const info = ref<UpdateInfo | null>(infoWithLastChecked(120))
    const { shouldShowBanner, daysSinceLastCheck } = mountWith(info, () => NOW)
    await flushPromises()
    expect(shouldShowBanner.value).toBe(true)
    expect(daysSinceLastCheck.value).toBe(120)
  })

  it('hides when last_checked_at is within the threshold (30 days)', async () => {
    const info = ref<UpdateInfo | null>(infoWithLastChecked(30))
    const { shouldShowBanner } = mountWith(info, () => NOW)
    await flushPromises()
    expect(shouldShowBanner.value).toBe(false)
  })

  it('hides after dismissal within the current 90-day cycle', async () => {
    const info = ref<UpdateInfo | null>(infoWithLastChecked(120))
    const { shouldShowBanner, dismiss } = mountWith(info, () => NOW)
    await flushPromises()
    expect(shouldShowBanner.value).toBe(true)
    dismiss()
    await flushPromises()
    expect(shouldShowBanner.value).toBe(false)
  })

  it('shows again after a NEW check completes (last_checked_at > dismissedAt)', async () => {
    // Seed an already-dismissed state from a previous cycle.
    storage[UPDATE_REMINDER_DISMISSED_KEY] = String(NOW - 100 * DAYS)
    // A check happens 30 days ago — still within threshold so hidden.
    const info = ref<UpdateInfo | null>(infoWithLastChecked(30))
    const { shouldShowBanner: hiddenWithinThreshold } = mountWith(info, () => NOW)
    await flushPromises()
    expect(hiddenWithinThreshold.value).toBe(false)

    // Re-mount 100 days later — last_checked_at is now 130 days old,
    // dismissedAt is older still, so the new cycle shows.
    const fakeNow = NOW + 100 * DAYS
    const { shouldShowBanner } = mountWith(info, () => fakeNow)
    await flushPromises()
    expect(shouldShowBanner.value).toBe(true)
  })
})
