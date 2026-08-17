import { defineComponent, h, ref } from 'vue'
import { render } from '@testing-library/vue'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { useGlobalKeyboard, type GlobalKeyboardDeps } from '@/composables/shared/keyboard/useGlobalKeyboard'
import type { MatchRecord } from '@/api-client'
import type { TabId, ViewId } from '@/composables/shared/keyboard/useTabKeyboardNav'

function press(key: string) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
}

// The `/` and `t` handlers are async: they await a view switch / panel
// open before stealing focus.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

const fixtures: HTMLElement[] = []

function mount(el: HTMLElement): HTMLElement {
  document.body.appendChild(el)
  fixtures.push(el)
  return el
}

function fixtureInput(id: string): HTMLInputElement {
  const input = document.createElement('input')
  input.id = id
  mount(input)
  return input
}

// The Matches dossier's "Filter matches" trigger: clicking it mounts the
// teleported narrow popover, which is where the search input lives.
function fixtureNarrowTrigger(): HTMLButtonElement {
  const actions = document.createElement('div')
  actions.className = 'dossier-actions'
  const trigger = document.createElement('button')
  trigger.className = 'dossier-btn primary'
  trigger.addEventListener('click', () => {
    const popover = document.createElement('div')
    popover.id = 'narrow-popover'
    const search = document.createElement('input')
    search.id = 'np-search'
    popover.appendChild(search)
    mount(popover)
  })
  actions.appendChild(trigger)
  mount(actions)
  return trigger
}

// happy-dom fails identity comparisons on activeElement (documented
// gotcha) — the id is the stable handle.
function focusedId(): string | undefined {
  return document.activeElement?.id
}

afterEach(() => {
  for (const el of fixtures.splice(0)) el.remove()
})

function makeDeps(overrides: Partial<GlobalKeyboardDeps> = {}): GlobalKeyboardDeps {
  return {
    view: ref<ViewId>('matches'),
    coachSessionActive: ref(false),
    openCheatsheet: ref(false),
    modalOpen: ref(false),
    selectionIsOpen: ref(false),
    selectedKey: ref<string | null>(null),
    closeSelection: vi.fn(),
    focusedCardIndex: ref(0),
    narrowedRecords: ref([{ match_key: 'm1' } as unknown as MatchRecord]),
    goToView: vi.fn(),
    focusCardByRenderedDelta: vi.fn(),
    focusCardByRenderedEnd: vi.fn(),
    focusSectionByRenderedDelta: vi.fn(),
    toggleExpand: vi.fn(),
    ...overrides,
  }
}

function mountKeyboard(deps: GlobalKeyboardDeps) {
  return render(defineComponent({
    setup() {
      useGlobalKeyboard(deps)
      return () => h('div')
    },
  }))
}

// Global shortcuts must go quiet while a modal other than the detail panel
// is up — 'e' toggling a card behind the narrow panel (or the export /
// About / manual-match modals) mutates state the user can't see.
describe('useGlobalKeyboard — modal suppression', () => {
  it("fires 'e' on the focused card when nothing modal is up", () => {
    const deps = makeDeps()
    const view = mountKeyboard(deps)
    press('e')
    expect(deps.toggleExpand).toHaveBeenCalledWith('m1')
    view.unmount()
  })

  it("suppresses 'e' while a non-panel modal is open", () => {
    const deps = makeDeps({ modalOpen: ref(true) })
    const view = mountKeyboard(deps)
    press('e')
    expect(deps.toggleExpand).not.toHaveBeenCalled()
    view.unmount()
  })

  it("keeps '?' reachable while a modal is up — the cheatsheet stacks over modals", () => {
    const deps = makeDeps({ modalOpen: ref(true) })
    const view = mountKeyboard(deps)
    press('?')
    expect(deps.openCheatsheet.value).toBe(true)
    view.unmount()
  })

  it('the detail panel deliberately does NOT suppress — e closes it on the focused card', () => {
    const deps = makeDeps({ selectionIsOpen: ref(true), selectedKey: ref<string | null>('m1') })
    const view = mountKeyboard(deps)
    press('e')
    expect(deps.closeSelection).toHaveBeenCalled()
    view.unmount()
  })
})

// The dispatcher skips every binding while focus sits in a text field —
// otherwise typing a hero name into the search box would fly the card
// focus around behind the panel.
describe('useGlobalKeyboard — typing in a field', () => {
  it('does not move card focus when the key was typed into an input', () => {
    const deps = makeDeps()
    const view = mountKeyboard(deps)
    fixtureInput('np-search').focus()

    press('j')
    press('g')
    press('m')

    expect(deps.focusCardByRenderedDelta).not.toHaveBeenCalled()
    expect(deps.goToView).not.toHaveBeenCalled()
    view.unmount()
  })

  it("keeps '?' reachable from inside a field — it is the discovery surface", () => {
    const deps = makeDeps()
    const view = mountKeyboard(deps)
    fixtureInput('np-search').focus()

    press('?')

    expect(deps.openCheatsheet.value).toBe(true)
    view.unmount()
  })
})

describe('useGlobalKeyboard — view navigation', () => {
  it('routes every `g <key>` sequence to its own tab', () => {
    const deps = makeDeps({ view: ref<ViewId>('settings') })
    const view = mountKeyboard(deps)

    const routes: [string, TabId][] = [
      ['m', 'matches'], ['i', 'ingest'], ['s', 'settings'],
      ['u', 'unknown'], ['c', 'compare'], ['e', 'elo'],
    ]
    for (const [follow, tab] of routes) {
      press('g')
      press(follow)
      expect(deps.goToView).toHaveBeenLastCalledWith(tab)
    }
    expect(deps.goToView).toHaveBeenCalledTimes(routes.length)
    view.unmount()
  })

  it('does nothing on a bare prefix press', () => {
    const deps = makeDeps({ view: ref<ViewId>('settings') })
    const view = mountKeyboard(deps)

    press('g')

    expect(deps.goToView).not.toHaveBeenCalled()
    view.unmount()
  })

  // `g f` is the film room. It is a view without a tab, and it only exists
  // while a bundle is open — outside a session the key must do nothing
  // rather than land the user on an empty panel.
  it('routes `g f` to the film room while a coaching session is open', () => {
    const deps = makeDeps({ view: ref<ViewId>('matches'), coachSessionActive: ref(true) })
    const view = mountKeyboard(deps)

    press('g')
    press('f')

    expect(deps.goToView).toHaveBeenCalledWith('coach')
    view.unmount()
  })

  it('ignores `g f` when no session is open', () => {
    const deps = makeDeps({ view: ref<ViewId>('matches') })
    const view = mountKeyboard(deps)

    press('g')
    press('f')

    expect(deps.goToView).not.toHaveBeenCalled()
    view.unmount()
  })
})

describe('useGlobalKeyboard — Matches list motions', () => {
  it('steps card focus with j/k and their arrow aliases', () => {
    const deps = makeDeps()
    const view = mountKeyboard(deps)

    press('j')
    press('ArrowDown')
    press('k')
    press('ArrowUp')

    expect(deps.focusCardByRenderedDelta).toHaveBeenCalledTimes(4)
    expect(deps.focusCardByRenderedDelta).toHaveBeenNthCalledWith(1, 1)
    expect(deps.focusCardByRenderedDelta).toHaveBeenNthCalledWith(2, 1)
    expect(deps.focusCardByRenderedDelta).toHaveBeenNthCalledWith(3, -1)
    expect(deps.focusCardByRenderedDelta).toHaveBeenNthCalledWith(4, -1)
    view.unmount()
  })

  it('yields j/k to the detail panel while it is open', () => {
    const deps = makeDeps({ selectionIsOpen: ref(true) })
    const view = mountKeyboard(deps)

    press('j')
    press('ArrowUp')

    expect(deps.focusCardByRenderedDelta).not.toHaveBeenCalled()
    view.unmount()
  })

  it('stays quiet on every other view', () => {
    const deps = makeDeps({ view: ref<ViewId>('settings') })
    const view = mountKeyboard(deps)

    press('j')
    press('n')
    press('G')

    expect(deps.focusCardByRenderedDelta).not.toHaveBeenCalled()
    expect(deps.focusSectionByRenderedDelta).not.toHaveBeenCalled()
    expect(deps.focusCardByRenderedEnd).not.toHaveBeenCalled()
    view.unmount()
  })

  it('jumps to the list ends with gg / G', () => {
    const deps = makeDeps()
    const view = mountKeyboard(deps)

    press('g')
    press('g')
    press('G')

    expect(deps.focusCardByRenderedEnd).toHaveBeenNthCalledWith(1, 'first')
    expect(deps.focusCardByRenderedEnd).toHaveBeenNthCalledWith(2, 'last')
    view.unmount()
  })

  it('steps between group sections with n / N', () => {
    const deps = makeDeps()
    const view = mountKeyboard(deps)

    press('n')
    press('N')

    expect(deps.focusSectionByRenderedDelta).toHaveBeenNthCalledWith(1, 1)
    expect(deps.focusSectionByRenderedDelta).toHaveBeenNthCalledWith(2, -1)
    view.unmount()
  })
})

describe('useGlobalKeyboard — opening the focused card', () => {
  it('drills into the focused card with l / →', () => {
    const deps = makeDeps()
    const view = mountKeyboard(deps)

    press('l')
    press('ArrowRight')

    expect(deps.toggleExpand).toHaveBeenCalledTimes(2)
    expect(deps.toggleExpand).toHaveBeenLastCalledWith('m1')
    view.unmount()
  })

  it('no-ops when no card is focused yet', () => {
    const deps = makeDeps({ focusedCardIndex: ref(-1) })
    const view = mountKeyboard(deps)

    press('l')
    press('e')
    press('t')

    expect(deps.toggleExpand).not.toHaveBeenCalled()
    view.unmount()
  })

  it('opens the card and lands focus in its tags editor on t', async () => {
    const deps = makeDeps()
    const view = mountKeyboard(deps)
    fixtureInput('tags-m1')

    press('t')
    await settle()

    expect(deps.toggleExpand).toHaveBeenCalledWith('m1')
    expect(focusedId()).toBe('tags-m1')
    view.unmount()
  })

  it('does not re-toggle a card that is already open when t is pressed', async () => {
    // toggleExpand is a toggle — calling it on the open card would shut
    // the panel the user just asked to type into.
    const deps = makeDeps({ selectedKey: ref<string | null>('m1'), selectionIsOpen: ref(true) })
    const view = mountKeyboard(deps)
    fixtureInput('tags-m1')

    press('t')
    await settle()

    expect(deps.toggleExpand).not.toHaveBeenCalled()
    expect(focusedId()).toBe('tags-m1')
    view.unmount()
  })

  it('survives a focus index left pointing past the end of the list', async () => {
    // A refetch can shrink narrowedRecords under a focused card.
    const deps = makeDeps({ focusedCardIndex: ref(7) })
    const view = mountKeyboard(deps)

    press('e')
    press('l')
    press('t')
    await settle()

    expect(deps.toggleExpand).not.toHaveBeenCalled()
    expect(deps.closeSelection).not.toHaveBeenCalled()
    view.unmount()
  })
})

describe('useGlobalKeyboard — the / shortcut', () => {
  it('switches to Matches, opens the narrow panel, and focuses its search', async () => {
    const deps = makeDeps({ view: ref<ViewId>('settings') })
    const view = mountKeyboard(deps)
    fixtureNarrowTrigger()

    press('/')
    await settle()

    expect(deps.goToView).toHaveBeenCalledWith('matches')
    expect(focusedId()).toBe('np-search')
    view.unmount()
  })

  it('leaves an already-open narrow panel alone and just takes focus', async () => {
    const deps = makeDeps()
    const view = mountKeyboard(deps)
    const trigger = fixtureNarrowTrigger()
    const opened = vi.fn()
    trigger.addEventListener('click', opened)
    // The popover is already mounted — re-clicking the trigger would
    // toggle it shut under the user.
    const popover = document.createElement('div')
    popover.id = 'narrow-popover'
    const search = document.createElement('input')
    search.id = 'np-search'
    popover.appendChild(search)
    mount(popover)

    press('/')
    await settle()

    expect(opened).not.toHaveBeenCalled()
    expect(focusedId()).toBe('np-search')
    view.unmount()
  })

  it('stays out of the way while the detail panel owns the keyboard', async () => {
    const deps = makeDeps({ selectionIsOpen: ref(true) })
    const view = mountKeyboard(deps)
    const trigger = fixtureNarrowTrigger()
    const opened = vi.fn()
    trigger.addEventListener('click', opened)

    press('/')
    await settle()

    expect(opened).not.toHaveBeenCalled()
    view.unmount()
  })
})
