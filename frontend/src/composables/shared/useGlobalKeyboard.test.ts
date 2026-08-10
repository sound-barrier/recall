import { defineComponent, h, ref } from 'vue'
import { render } from '@testing-library/vue'
import { describe, it, expect, vi } from 'vitest'
import { useGlobalKeyboard, type GlobalKeyboardDeps } from '@/composables/shared/useGlobalKeyboard'
import type { MatchRecord } from '@/api-client'
import type { TabId } from '@/composables/shared/useTabKeyboardNav'

function press(key: string) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
}

function makeDeps(overrides: Partial<GlobalKeyboardDeps> = {}): GlobalKeyboardDeps {
  return {
    view: ref<TabId>('matches'),
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
