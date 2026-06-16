import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { effectScope, ref } from 'vue'

import { useNarrowTabNav } from '@/composables/matches/useNarrowTabNav'

// Builds a Narrow-panel-like DOM: search input, a toggle button, a
// second (date) input, another toggle — interleaved the way the real
// panel is. Returns the elements so tests can focus + assert.
function buildPanel() {
  const root = document.createElement('div')
  root.innerHTML = `
    <input id="search" type="search">
    <button id="chip-a">Comp</button>
    <input id="date" type="date">
    <button id="chip-b">QP</button>
  `
  document.body.appendChild(root)
  return {
    root,
    search: root.querySelector<HTMLInputElement>('#search')!,
    date: root.querySelector<HTMLInputElement>('#date')!,
    chipA: root.querySelector<HTMLButtonElement>('#chip-a')!,
    chipB: root.querySelector<HTMLButtonElement>('#chip-b')!,
  }
}

function pressTab(opts: { shift?: boolean } = {}) {
  const e = new KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey: !!opts.shift,
    bubbles: true,
    cancelable: true,
  })
  document.dispatchEvent(e)
  return e
}

describe('useNarrowTabNav', () => {
  let scope: ReturnType<typeof effectScope>

  beforeEach(() => {
    document.body.innerHTML = ''
  })
  afterEach(() => {
    scope?.stop()
    document.body.innerHTML = ''
  })

  function mount(root: HTMLElement) {
    scope = effectScope()
    scope.run(() => useNarrowTabNav(ref(root)))
  }

  it('Tab from an empty input jumps to the next toggle button', () => {
    const p = buildPanel()
    mount(p.root)
    p.search.focus()
    const e = pressTab()
    expect(e.defaultPrevented).toBe(true)
    expect(document.activeElement?.id).toBe('chip-a')
  })

  it('Shift+Tab from an empty input jumps to the previous toggle', () => {
    const p = buildPanel()
    mount(p.root)
    p.date.focus()
    const e = pressTab({ shift: true })
    expect(e.defaultPrevented).toBe(true)
    expect(document.activeElement?.id).toBe('chip-a')
  })

  it('does nothing when the input has a value (normal Tab)', () => {
    const p = buildPanel()
    mount(p.root)
    p.search.value = 'rialto'
    p.search.focus()
    const e = pressTab()
    expect(e.defaultPrevented).toBe(false)
  })

  it('does not trap: no toggle after focus → native Tab proceeds', () => {
    const p = buildPanel()
    mount(p.root)
    // chipB is the last button; focus an empty input placed AFTER it.
    const trailing = document.createElement('input')
    trailing.type = 'text'
    p.root.appendChild(trailing)
    trailing.focus()
    const e = pressTab()
    expect(e.defaultPrevented).toBe(false)
  })

  it('ignores Tab when focus is outside the container', () => {
    const p = buildPanel()
    mount(p.root)
    const outside = document.createElement('input')
    outside.type = 'text'
    document.body.appendChild(outside)
    outside.focus()
    const e = pressTab()
    expect(e.defaultPrevented).toBe(false)
  })
})
