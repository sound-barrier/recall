import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/vue'
import { createPinia, setActivePinia } from 'pinia'

// Section 07's two rows answer to two different gates, and getting either
// backwards hides a control from the people who need it: close behavior is
// meaningless on macOS, and resetting a native window is meaningless in the
// browser build, where there is no window. IS_WAILS is a module-level const
// read at import time, so each case re-imports the component behind a fresh
// mock rather than trying to change it afterwards.

afterEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  vi.unstubAllGlobals()
})

async function renderWindowSection(platform: { mac: boolean, desktop: boolean }) {
  vi.doMock('@/platform', () => ({
    isMacOS: () => platform.mac,
    IS_WAILS: platform.desktop,
  }))
  setActivePinia(createPinia())
  const { default: SettingsWindow } = await import('@/components/settings/SettingsWindow.vue')
  const { useSettingsStore } = await import('@/stores/settings')
  const store = useSettingsStore()
  const resetWindowSize = vi.spyOn(store, 'resetWindowSize').mockResolvedValue(undefined)
  render(SettingsWindow)
  return { resetWindowSize }
}

const resetButton = () => screen.queryByRole('button', { name: /reset/i })
const closeToggle = () => screen.queryByRole('checkbox', { name: /quit recall when the window closes/i })

describe('Settings — Window', () => {
  it('offers the size reset in the desktop build', async () => {
    const { resetWindowSize } = await renderWindowSection({ mac: false, desktop: true })
    const button = resetButton()
    expect(button).not.toBeNull()

    button!.click()
    expect(resetWindowSize).toHaveBeenCalledTimes(1)
  })

  it('hides the size reset in the browser build, where there is no window', async () => {
    await renderWindowSection({ mac: false, desktop: false })
    expect(resetButton()).toBeNull()
    // The close-behavior row is a separate question and still belongs here.
    expect(closeToggle()).not.toBeNull()
  })

  it('keeps the size reset on macOS, where only close behavior does not apply', async () => {
    await renderWindowSection({ mac: true, desktop: true })
    expect(resetButton()).not.toBeNull()
    expect(closeToggle()).toBeNull()
  })

  it('renders nothing when neither row applies', async () => {
    await renderWindowSection({ mac: true, desktop: false })
    expect(screen.queryByRole('heading', { name: /window/i })).toBeNull()
  })
})
