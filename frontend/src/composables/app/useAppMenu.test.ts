import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope } from 'vue'

// The masthead ⋮ menu duplicates the native macOS menu bar, so it hides on
// macOS-desktop and shows everywhere else. That gate reads the shared
// IS_WAILS (serving origin) — it used to hand-roll its own
// navigator.userAgent check, which reads false in the Windows desktop
// build. The outcome matrix is the contract; pin all three shapes.

const realLocation = window.location
const realUA = navigator.userAgent

function envLocation(opts: { wails: boolean; mac: boolean }): { protocol: string; hostname: string } {
  if (!opts.wails) return { protocol: 'http:', hostname: 'localhost' }
  if (opts.mac) return { protocol: 'wails:', hostname: 'localhost' }
  return { protocol: 'http:', hostname: 'wails.localhost' }
}

function setEnv(opts: { wails: boolean; mac: boolean }) {
  const loc = envLocation(opts)
  Object.defineProperty(window, 'location', {
    value: { ...loc, href: `${loc.protocol}//${loc.hostname}/` },
    configurable: true,
  })
  Object.defineProperty(navigator, 'userAgent', {
    value: opts.mac
      ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/125.0.0.0',
    configurable: true,
  })
}

async function showMenuFor(opts: { wails: boolean; mac: boolean }): Promise<boolean> {
  setEnv(opts)
  vi.resetModules()
  setActivePinia(createPinia())
  const { useAppMenu } = await import('@/composables/app/useAppMenu')
  const scope = effectScope()
  const menu = scope.run(() => useAppMenu())!
  const value = menu.showMenu.value
  scope.stop()
  return value
}

beforeEach(() => { vi.resetModules() })

afterEach(() => {
  Object.defineProperty(window, 'location', { value: realLocation, configurable: true })
  Object.defineProperty(navigator, 'userAgent', { value: realUA, configurable: true })
})

describe('useAppMenu — kebab visibility', () => {
  it('hides on macOS desktop (the native menu bar owns those actions)', async () => {
    expect(await showMenuFor({ wails: true, mac: true })).toBe(false)
  })

  it('shows in the Windows desktop build (no native menu bar there)', async () => {
    expect(await showMenuFor({ wails: true, mac: false })).toBe(true)
  })

  it('shows in browser / server mode on any OS', async () => {
    expect(await showMenuFor({ wails: false, mac: true })).toBe(true)
    expect(await showMenuFor({ wails: false, mac: false })).toBe(true)
  })
})
