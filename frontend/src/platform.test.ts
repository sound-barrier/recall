import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

// IS_WAILS is THE runtime detector — three surfaces read it (the api
// transport's native-dialog branch, the masthead kebab, the Matches
// context menu), and it has been wrong in production twice: once serving
// every API call to a 404 on Windows, once hiding a context-menu item
// there. Both regressions came from deriving it out of navigator.userAgent,
// which Wails never populates on Windows (the marker rides the outgoing
// request headers instead). These pin the origins.
//
// The constant is evaluated at module load, so each case stubs
// window.location, drops the module cache, and re-imports.

const realLocation = window.location
const realUA = navigator.userAgent

function setLocation(protocol: string, hostname: string) {
  Object.defineProperty(window, 'location', {
    value: { protocol, hostname, href: `${protocol}//${hostname}/` },
    configurable: true,
  })
}

function setUA(ua: string) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true })
}

async function freshPlatform() {
  vi.resetModules()
  return import('@/platform')
}

beforeEach(() => { vi.resetModules() })

afterEach(() => {
  Object.defineProperty(window, 'location', { value: realLocation, configurable: true })
  setUA(realUA)
})

describe('IS_WAILS', () => {
  it('is true for the macOS custom scheme', async () => {
    setLocation('wails:', 'localhost')
    expect((await freshPlatform()).IS_WAILS).toBe(true)
  })

  it('is true for the Windows virtual host EVEN WITHOUT a UA marker', async () => {
    // The regression that shipped: Windows WebView2 carries a plain Edge UA,
    // so a userAgent-based detector reads false and every call 404s against
    // the desktop asset server.
    setLocation('http:', 'wails.localhost')
    setUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      + '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0')
    expect((await freshPlatform()).IS_WAILS).toBe(true)
  })

  it('is false in a normal browser (server mode / e2e)', async () => {
    setLocation('http:', 'localhost')
    expect((await freshPlatform()).IS_WAILS).toBe(false)
  })

  it('does NOT trust a UA marker on a non-Wails origin', async () => {
    // The inverse guard: a UA string is attacker/extension-influenceable and
    // is no longer part of the signal.
    setLocation('http:', 'example.com')
    setUA('Mozilla/5.0 wails.io')
    expect((await freshPlatform()).IS_WAILS).toBe(false)
  })
})

describe('isMacOS', () => {
  it('reads the host OS off the user-agent', async () => {
    setUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
    expect((await freshPlatform()).isMacOS()).toBe(true)
    setUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
    expect((await freshPlatform()).isMacOS()).toBe(false)
  })
})
