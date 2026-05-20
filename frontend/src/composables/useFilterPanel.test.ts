import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { effectScope } from 'vue'
import { shouldCloseOnOutsideClick, useFilterPanel } from './useFilterPanel'

// effectScope lets us call the composable and get reactive refs back
// without needing a mounted component. onMounted/onBeforeUnmount emit
// Vue warnings (no active instance) which we suppress — those lifecycle
// hooks only register DOM listeners and are tested by inspection.
function withScope<T>(fn: () => T): T {
  let result!: T
  const scope = effectScope()
  scope.run(() => { result = fn() })
  return result
}

// ─── shouldCloseOnOutsideClick ───────────────────────────────────────

describe('shouldCloseOnOutsideClick', () => {
  it('returns false when no panel is open', () => {
    expect(shouldCloseOnOutsideClick(null, false)).toBe(false)
  })

  it('returns true when panel is open and click is outside .multi-filter', () => {
    const outside = { closest: (_: string) => null } as unknown as Element
    expect(shouldCloseOnOutsideClick(outside, true)).toBe(true)
  })

  it('returns false when click lands inside .multi-filter', () => {
    const inside = {
      closest: (sel: string) => sel === '.multi-filter' ? {} as Element : null,
    } as unknown as Element
    expect(shouldCloseOnOutsideClick(inside, true)).toBe(false)
  })

  it('returns true when target is null and panel is open (body click)', () => {
    expect(shouldCloseOnOutsideClick(null, true)).toBe(true)
  })
})

// ─── useFilterPanel ──────────────────────────────────────────────────

describe('useFilterPanel', () => {
  beforeEach(() => {
    // Suppress Vue's "onMounted called outside of setup" warning.
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('starts with no panel open', () => {
    const { openFilter } = withScope(useFilterPanel)
    expect(openFilter.value).toBe('')
  })

  it('filterSearch starts with empty strings for every field', () => {
    const { filterSearch } = withScope(useFilterPanel)
    for (const v of Object.values(filterSearch.value)) {
      expect(v).toBe('')
    }
  })

  it('toggleFilterPanel opens a field', () => {
    const { openFilter, toggleFilterPanel } = withScope(useFilterPanel)
    toggleFilterPanel('mode')
    expect(openFilter.value).toBe('mode')
  })

  it('toggleFilterPanel closes the field when toggled a second time', () => {
    const { openFilter, toggleFilterPanel } = withScope(useFilterPanel)
    toggleFilterPanel('mode')
    toggleFilterPanel('mode')
    expect(openFilter.value).toBe('')
  })

  it('toggleFilterPanel switches directly to a different field', () => {
    const { openFilter, toggleFilterPanel } = withScope(useFilterPanel)
    toggleFilterPanel('mode')
    toggleFilterPanel('map')
    expect(openFilter.value).toBe('map')
  })

  it('toggleFilterPanel clears the search string when opening', () => {
    const { filterSearch, toggleFilterPanel } = withScope(useFilterPanel)
    filterSearch.value = { ...filterSearch.value, map: 'kings' }
    toggleFilterPanel('map')
    expect(filterSearch.value.map).toBe('')
  })

  it('toggleFilterPanel does not clear search when closing', () => {
    // Open populates a search string after the clear-on-open, then close.
    // The search string set AFTER opening must survive the close.
    const { filterSearch, toggleFilterPanel } = withScope(useFilterPanel)
    toggleFilterPanel('map')                              // open (clears)
    filterSearch.value = { ...filterSearch.value, map: 'kings' } // user types
    toggleFilterPanel('map')                              // close
    expect(filterSearch.value.map).toBe('kings')
  })

  it('closeFilterPanel empties openFilter', () => {
    const { openFilter, toggleFilterPanel, closeFilterPanel } = withScope(useFilterPanel)
    toggleFilterPanel('mode')
    closeFilterPanel()
    expect(openFilter.value).toBe('')
  })

  it('closeFilterPanel is a no-op when no panel is open', () => {
    const { openFilter, closeFilterPanel } = withScope(useFilterPanel)
    closeFilterPanel()
    expect(openFilter.value).toBe('')
  })
})
