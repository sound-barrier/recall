import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, nextTick } from 'vue'
import { useTabKeyboardNav, TAB_ORDER, type TabId } from './useTabKeyboardNav'

function key(name: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: name, cancelable: true })
}

// Stub the four tab buttons so the focus() call after nextTick hits
// real elements. The composable's contract is "focus the button with
// id `tab-<target>`" — we verify by spying on focus().
function seedTabButtons() {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild)
  for (const t of TAB_ORDER) {
    const btn = document.createElement('button')
    btn.id = `tab-${t}`
    document.body.appendChild(btn)
  }
}

function seedMain() {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild)
  const main = document.createElement('main')
  main.id = 'main-content'
  main.tabIndex = -1
  document.body.appendChild(main)
  return main
}

describe('useTabKeyboardNav', () => {
  beforeEach(() => { seedTabButtons() })

  afterEach(() => {
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild)
    vi.restoreAllMocks()
  })

  it('exports TAB_ORDER in nav order', () => {
    expect(TAB_ORDER).toEqual(['settings', 'ingest', 'matches', 'unknown'])
  })

  it('ArrowRight moves to the next tab and calls goToView', () => {
    const view = ref<string>('settings')
    const go = vi.fn()
    const { onTabKeydown } = useTabKeyboardNav(view, go)
    onTabKeydown(key('ArrowRight'))
    expect(go).toHaveBeenCalledWith('ingest')
  })

  it('ArrowLeft moves to the previous tab', () => {
    const view = ref<string>('ingest')
    const go = vi.fn()
    const { onTabKeydown } = useTabKeyboardNav(view, go)
    onTabKeydown(key('ArrowLeft'))
    expect(go).toHaveBeenCalledWith('settings')
  })

  it('ArrowLeft from the first tab wraps to the last', () => {
    const view = ref<string>('settings')
    const go = vi.fn()
    const { onTabKeydown } = useTabKeyboardNav(view, go)
    onTabKeydown(key('ArrowLeft'))
    expect(go).toHaveBeenCalledWith('unknown')
  })

  it('ArrowRight from the last tab wraps to the first', () => {
    const view = ref<string>('unknown')
    const go = vi.fn()
    const { onTabKeydown } = useTabKeyboardNav(view, go)
    onTabKeydown(key('ArrowRight'))
    expect(go).toHaveBeenCalledWith('settings')
  })

  it('Home jumps to the first tab', () => {
    const view = ref<string>('matches')
    const go = vi.fn()
    const { onTabKeydown } = useTabKeyboardNav(view, go)
    onTabKeydown(key('Home'))
    expect(go).toHaveBeenCalledWith('settings')
  })

  it('End jumps to the last tab', () => {
    const view = ref<string>('settings')
    const go = vi.fn()
    const { onTabKeydown } = useTabKeyboardNav(view, go)
    onTabKeydown(key('End'))
    expect(go).toHaveBeenCalledWith('unknown')
  })

  it('non-navigation keys are ignored (no goToView, no preventDefault)', () => {
    const view = ref<string>('settings')
    const go = vi.fn()
    const { onTabKeydown } = useTabKeyboardNav(view, go)
    const ev = key('Enter')
    const prevented = vi.spyOn(ev, 'preventDefault')
    onTabKeydown(ev)
    expect(go).not.toHaveBeenCalled()
    expect(prevented).not.toHaveBeenCalled()
  })

  it('preventDefault is called on navigation keys', () => {
    const view = ref<string>('settings')
    const { onTabKeydown } = useTabKeyboardNav(view, vi.fn())
    const ev = key('ArrowRight')
    const prevented = vi.spyOn(ev, 'preventDefault')
    onTabKeydown(ev)
    expect(prevented).toHaveBeenCalled()
  })

  it('off-list view does not call goToView (defensive)', () => {
    const view = ref<string>('something-unexpected')
    const go = vi.fn()
    const { onTabKeydown } = useTabKeyboardNav(view, go)
    onTabKeydown(key('ArrowRight'))
    expect(go).not.toHaveBeenCalled()
  })

  it('focuses the newly-active tab button on the next tick', async () => {
    const view = ref<string>('settings')
    const go = vi.fn<(t: TabId) => void>()
    const { onTabKeydown } = useTabKeyboardNav(view, go)
    const ingestBtn = document.getElementById('tab-ingest')!
    const focusSpy = vi.spyOn(ingestBtn, 'focus')
    onTabKeydown(key('ArrowRight'))
    await nextTick()
    expect(focusSpy).toHaveBeenCalled()
  })

  it('focusMain focuses #main-content and preventDefaults the click', () => {
    const main = seedMain()
    const view = ref<string>('settings')
    const { focusMain } = useTabKeyboardNav(view, vi.fn())
    const focusSpy = vi.spyOn(main, 'focus')
    const ev = new MouseEvent('click', { cancelable: true })
    const prevented = vi.spyOn(ev, 'preventDefault')
    focusMain(ev)
    expect(prevented).toHaveBeenCalled()
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: false })
  })
})
