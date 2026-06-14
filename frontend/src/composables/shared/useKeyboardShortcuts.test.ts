import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { useKeyboardShortcuts, SEQUENCE_TIMEOUT_MS, type Shortcut } from '@/composables/shared/useKeyboardShortcuts'

// Each test mounts a fresh harness so onScopeDispose tears down the
// document listener between cases. happy-dom provides `document` +
// dispatchEvent — KeyboardEvent works out of the box.

// helper: dispatch a keydown on document with the given key + options
function press(key: string, opts: KeyboardEventInit = {}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts })
  document.dispatchEvent(ev)
  return ev
}

// helper: mount a tiny harness so the composable's onScopeDispose
// fires when we unmount, and return the wrapper + spy bag.
function mountWithShortcuts(shortcuts: readonly Shortcut[]) {
  const w = mount(defineComponent({
    setup() {
      useKeyboardShortcuts(shortcuts)
      return () => h('div')
    },
  }))
  return w
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-05-28T00:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useKeyboardShortcuts — single-key dispatch', () => {
  it('fires the handler when the matching key is pressed', () => {
    const fn = vi.fn()
    const w = mountWithShortcuts([{ key: '/', handler: fn }])
    press('/')
    expect(fn).toHaveBeenCalledTimes(1)
    w.unmount()
  })

  it('preventDefault is called by default', () => {
    const fn = vi.fn()
    const w = mountWithShortcuts([{ key: '/', handler: fn }])
    const ev = press('/')
    expect(ev.defaultPrevented).toBe(true)
    w.unmount()
  })

  it('preventDefault opt-out via preventDefault: false', () => {
    const fn = vi.fn()
    const w = mountWithShortcuts([{ key: '/', handler: fn, preventDefault: false }])
    const ev = press('/')
    expect(ev.defaultPrevented).toBe(false)
    w.unmount()
  })

  it('does NOT fire on a non-matching key', () => {
    const fn = vi.fn()
    const w = mountWithShortcuts([{ key: '/', handler: fn }])
    press('a')
    expect(fn).not.toHaveBeenCalled()
    w.unmount()
  })

  it('key: [...] array matches any of the listed keys', () => {
    const fn = vi.fn()
    const w = mountWithShortcuts([{ key: ['j', 'ArrowDown'], handler: fn }])
    press('j')
    press('ArrowDown')
    expect(fn).toHaveBeenCalledTimes(2)
    w.unmount()
  })
})

describe('useKeyboardShortcuts — when predicate', () => {
  it('skips the handler when when() returns false', () => {
    const fn = vi.fn()
    let gate = false
    const w = mountWithShortcuts([{ key: 'j', when: () => gate, handler: fn }])
    press('j')
    expect(fn).not.toHaveBeenCalled()
    gate = true
    press('j')
    expect(fn).toHaveBeenCalledTimes(1)
    w.unmount()
  })
})

describe('useKeyboardShortcuts — modifier suppression', () => {
  it('Ctrl+key does not fire', () => {
    const fn = vi.fn()
    const w = mountWithShortcuts([{ key: '/', handler: fn }])
    press('/', { ctrlKey: true })
    expect(fn).not.toHaveBeenCalled()
    w.unmount()
  })

  it('Meta+key does not fire', () => {
    const fn = vi.fn()
    const w = mountWithShortcuts([{ key: '/', handler: fn }])
    press('/', { metaKey: true })
    expect(fn).not.toHaveBeenCalled()
    w.unmount()
  })

  it('Alt+key does not fire', () => {
    const fn = vi.fn()
    const w = mountWithShortcuts([{ key: '/', handler: fn }])
    press('/', { altKey: true })
    expect(fn).not.toHaveBeenCalled()
    w.unmount()
  })

  it('Shift+key DOES fire (required for ?, !, etc.)', () => {
    const fn = vi.fn()
    const w = mountWithShortcuts([{ key: '?', handler: fn }])
    press('?', { shiftKey: true })
    expect(fn).toHaveBeenCalledTimes(1)
    w.unmount()
  })
})

describe('useKeyboardShortcuts — input gating', () => {
  let input: HTMLInputElement

  beforeEach(() => {
    input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
  })

  afterEach(() => {
    input.remove()
  })

  it('does NOT fire when focus is in a non-allow-in-input shortcut', () => {
    const fn = vi.fn()
    const w = mountWithShortcuts([{ key: 'j', handler: fn }])
    press('j')
    expect(fn).not.toHaveBeenCalled()
    w.unmount()
  })

  it('DOES fire when allowInInput: true', () => {
    const fn = vi.fn()
    const w = mountWithShortcuts([{ key: '?', allowInInput: true, handler: fn }])
    press('?')
    expect(fn).toHaveBeenCalledTimes(1)
    w.unmount()
  })

  it('treats TEXTAREA as an input', () => {
    input.remove()
    const ta = document.createElement('textarea')
    document.body.appendChild(ta)
    ta.focus()
    const fn = vi.fn()
    const w = mountWithShortcuts([{ key: 'j', handler: fn }])
    press('j')
    expect(fn).not.toHaveBeenCalled()
    ta.remove()
    w.unmount()
  })

  it('treats contenteditable as an input', () => {
    input.remove()
    const div = document.createElement('div')
    div.setAttribute('contenteditable', 'true')
    document.body.appendChild(div)
    div.focus()
    const fn = vi.fn()
    const w = mountWithShortcuts([{ key: 'j', handler: fn }])
    press('j')
    expect(fn).not.toHaveBeenCalled()
    div.remove()
    w.unmount()
  })
})

describe('useKeyboardShortcuts — sequence prefix', () => {
  it('g then m fires the prefixed handler', () => {
    const fn = vi.fn()
    const w = mountWithShortcuts([
      { key: 'm', prefix: 'g', handler: fn },
    ])
    press('g')
    expect(fn).not.toHaveBeenCalled() // prefix alone doesn't fire
    press('m')
    expect(fn).toHaveBeenCalledTimes(1)
    w.unmount()
  })

  it('g then m after SEQUENCE_TIMEOUT_MS does NOT fire (prefix expired)', () => {
    const fn = vi.fn()
    const w = mountWithShortcuts([
      { key: 'm', prefix: 'g', handler: fn },
    ])
    press('g')
    vi.advanceTimersByTime(SEQUENCE_TIMEOUT_MS + 50)
    press('m')
    expect(fn).not.toHaveBeenCalled()
    w.unmount()
  })

  it('a stale prefix falls through to a non-prefix shortcut on the next key', () => {
    // Press `g` (prefix primed), wait past timeout, then press `/`
    // (which has no prefix and should still fire).
    const seq = vi.fn()
    const slash = vi.fn()
    const w = mountWithShortcuts([
      { key: 'm', prefix: 'g', handler: seq },
      { key: '/', handler: slash },
    ])
    press('g')
    vi.advanceTimersByTime(SEQUENCE_TIMEOUT_MS + 50)
    press('/')
    expect(seq).not.toHaveBeenCalled()
    expect(slash).toHaveBeenCalledTimes(1)
    w.unmount()
  })

  it('non-matching follow-up after prefix is a no-op (clears the prefix without firing)', () => {
    const seq = vi.fn()
    const w = mountWithShortcuts([
      { key: 'm', prefix: 'g', handler: seq },
    ])
    press('g')
    press('x') // not registered as either prefix or shortcut
    press('m') // prefix was cleared by the previous press; this is a bare 'm'
    expect(seq).not.toHaveBeenCalled()
    w.unmount()
  })

  it('g typed in an input element does NOT prime the prefix', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    const fn = vi.fn()
    const w = mountWithShortcuts([
      { key: 'm', prefix: 'g', handler: fn },
    ])
    press('g')
    input.blur()
    press('m')
    expect(fn).not.toHaveBeenCalled()
    input.remove()
    w.unmount()
  })
})

describe('useKeyboardShortcuts — cleanup', () => {
  it('unmount removes the document listener', () => {
    const fn = vi.fn()
    const w = mountWithShortcuts([{ key: '/', handler: fn }])
    press('/')
    expect(fn).toHaveBeenCalledTimes(1)
    w.unmount()
    press('/')
    expect(fn).toHaveBeenCalledTimes(1) // no second call
  })
})

describe('useKeyboardShortcuts — exposed inspection helpers', () => {
  it('hasPendingPrefix flips after prefix key', () => {
    let api: ReturnType<typeof useKeyboardShortcuts> | undefined
    const w = mount(defineComponent({
      setup() {
        api = useKeyboardShortcuts([{ key: 'm', prefix: 'g', handler: () => {} }])
        return () => h('div')
      },
    }))
    expect(api!.hasPendingPrefix()).toBe(false)
    press('g')
    expect(api!.hasPendingPrefix()).toBe(true)
    api!.resetPrefix()
    expect(api!.hasPendingPrefix()).toBe(false)
    w.unmount()
  })
})
