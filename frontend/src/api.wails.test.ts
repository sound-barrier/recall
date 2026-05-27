// Wails-mode tests for the api.ts shim.
//
// IS_WAILS in api.ts is a module-level `const` evaluated at import
// time from `window.go?.app?.App`. To exercise the Wails branch we
// install the bridge on the global `window`, call vi.resetModules()
// so the cached api module is dropped, then dynamic-import api to
// trigger a fresh IS_WAILS evaluation against the stubbed bridge.
//
// This file is split from api.test.ts because vi.resetModules()
// drops every cached module — leaving a later same-file test that
// re-imports api with a different intended IS_WAILS state at the
// mercy of which module instance lands first. Vitest's file-level
// worker isolation keeps that state local here.

import { describe, it, expect, vi, afterEach } from 'vitest'

describe('SetMatchAnnotation (Wails mode)', () => {
  function installBridge(setSpy: ReturnType<typeof vi.fn>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).go = { app: { App: { SetMatchAnnotation: setSpy } } }
    vi.resetModules()
  }

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).go
  })

  // The Go method's signature is `SetMatchAnnotation(in AnnotationInput)`
  // — one arg. Passing (matchKey, input) trips Wails' arity check with
  // "received 2 arguments to method 'app.App.SetMatchAnnotation',
  // expected 1". This test pins the contract so any future refactor
  // back to a multi-arg shape fails fast.
  it('calls the bridge with exactly one AnnotationInput arg (not matchKey + input)', async () => {
    const setSpy = vi.fn(async () => undefined)
    installBridge(setSpy)
    const { SetMatchAnnotation } = await import('./api')
    await SetMatchAnnotation('match:2026-05-10T22:21:11', {
      leaver: 'team', note: 'ally rage-quit', replay_code: '7H1K9P', members: ['Apollo#1'],
    })
    expect(setSpy).toHaveBeenCalledTimes(1)
    // lastCall is the tuple of args; asserting equality on the whole
    // tuple locks both arity (length 1) and shape in one expect.
    expect(setSpy.mock.lastCall).toEqual([{
      MatchKey:   'match:2026-05-10T22:21:11',
      Leaver:     'team',
      Note:       'ally rage-quit',
      ReplayCode: '7H1K9P',
      Members:    ['Apollo#1'],
      Tags:       [],
    }])
  })

  // AnnotationInput in pkg/app/match_annotation.go has no `json:` tags,
  // so encoding/json on the Go side uses exact Go field names. Partial
  // TS inputs (note-only edit, members-only edit) must still send a
  // complete struct so empty fields read as "" / [] server-side.
  it('defaults missing input fields to empty so Go sees a complete struct', async () => {
    const setSpy = vi.fn(async () => undefined)
    installBridge(setSpy)
    const { SetMatchAnnotation } = await import('./api')
    await SetMatchAnnotation('match:x', { note: 'just a note' })
    expect(setSpy.mock.lastCall).toEqual([{
      MatchKey: 'match:x', Leaver: '', Note: 'just a note', ReplayCode: '', Members: [], Tags: [],
    }])
  })
})
