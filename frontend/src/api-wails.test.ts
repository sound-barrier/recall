import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Wails-bridge tests live in their own file because forcing IS_WAILS=true
// requires stubbing window.go BEFORE importing api.ts, which means
// vi.resetModules() — and resetting the module graph mid-suite breaks
// `instanceof ApiError` checks in api.test.ts (the ApiError class
// captured at top-of-file gets replaced by the freshly-imported one).
// Isolating to a separate file is the cheapest fix.

describe('api — Wails bridge dispatch', () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.unstubAllGlobals() })

  // The Go side of SetLeaverAnnotation is
  // `(matchKey, leaver, note string)` and the Wails bridge does a
  // strict arity check. Previously the TS type marked `note` as
  // optional, so a caller could legally omit it and crash at runtime
  // with "received 2 arguments, expected 3". This guard re-imports
  // api against a stubbed window.go.app.App and asserts the dispatch
  // carries all three positional args.
  it('SetLeaverAnnotation dispatches with all 3 positional args', async () => {
    const bridge = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', {
      go: { app: { App: { SetLeaverAnnotation: bridge } } },
    })
    const api = await import('./api')
    await api.SetLeaverAnnotation('match:1', 'self', '')
    expect(bridge).toHaveBeenCalledTimes(1)
    expect(bridge).toHaveBeenCalledWith('match:1', 'self', '')
  })

  it('ClearLeaverAnnotation dispatches with the matchKey only', async () => {
    const bridge = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', {
      go: { app: { App: { ClearLeaverAnnotation: bridge } } },
    })
    const api = await import('./api')
    await api.ClearLeaverAnnotation('match:1')
    expect(bridge).toHaveBeenCalledWith('match:1')
  })
})
