import { describe, it, expect } from 'vitest'
import {
  WIDGET_REGISTRY,
  DEFAULT_ROW_LAYOUT,
  widgetById,
} from './widgets'

describe('dashboard widget registry', () => {
  it('every default-row id appears at most once across all rows', () => {
    // PR B: the registry now distinguishes default-install widgets
    // (in DEFAULT_ROW_LAYOUT) from opt-in widgets (registered but not
    // in any default row). The invariant for installed widgets is
    // "no double-listing"; opt-in widgets sit in WIDGET_REGISTRY
    // without a layout entry until the user explicitly adds them.
    const registryIds = new Set(WIDGET_REGISTRY.map((w) => w.id))
    const layoutCounts = new Map<string, number>()
    for (const row of Object.values(DEFAULT_ROW_LAYOUT)) {
      for (const id of row) {
        layoutCounts.set(id, (layoutCounts.get(id) ?? 0) + 1)
      }
    }
    // No layout entry references a widget the registry doesn't ship.
    for (const id of layoutCounts.keys()) {
      expect(registryIds.has(id), `layout references unknown widget ${id}`).toBe(true)
      expect(layoutCounts.get(id), `${id} should appear at most once`).toBe(1)
    }
  })

  it('every widget has a unique kebab-case id', () => {
    const ids = WIDGET_REGISTRY.map((w) => w.id)
    expect(new Set(ids).size, 'duplicate widget ids').toBe(ids.length)
    for (const id of ids) {
      expect(id, `${id} must be lowercase kebab-case`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    }
  })

  it('each widget declares a shape; default-install widgets sit in their declared defaultRow', () => {
    // Opt-in widgets (registered but absent from DEFAULT_ROW_LAYOUT)
    // declare a `defaultRow` to govern their FIRST insertion point
    // via the customizer's "+ Add" — they don't have to actually
    // live in that row before a user adds them. Default-install
    // widgets must match.
    const defaultIds = new Set(Object.values(DEFAULT_ROW_LAYOUT).flat())
    for (const w of WIDGET_REGISTRY) {
      expect(w.shape === 'kpi' || w.shape === 'breakdown', `${w.id} shape`).toBe(true)
      if (defaultIds.has(w.id)) {
        expect(DEFAULT_ROW_LAYOUT[w.defaultRow], `${w.id} declares defaultRow ${w.defaultRow} but no such row exists`).toBeDefined()
        expect(DEFAULT_ROW_LAYOUT[w.defaultRow]?.includes(w.id), `${w.id} declares defaultRow ${w.defaultRow} but isn't in it`).toBe(true)
      }
    }
  })

  it('widgetById returns the def for known ids and undefined for unknown', () => {
    expect(widgetById('winrate')?.eyebrow).toBe('Winrate')
    expect(widgetById('top-roles')?.shape).toBe('breakdown')
    expect(widgetById('this-id-does-not-exist')).toBeUndefined()
  })

  it('default layout matches the pre-refactor visual order', () => {
    // The first row was the KPI row in the pre-refactor MatchesView,
    // ordered: Winrate, Avg K/D/A, Total time, Most played hero,
    // Matches reviewed, Days since review, W/L/D since review.
    expect(DEFAULT_ROW_LAYOUT[1]).toEqual([
      'winrate', 'avg-kda', 'total-time', 'most-played-hero',
      'reviewed-count', 'days-since-review', 'wld-since-review',
    ])
    // Second row was the breakdown row: maps, heroes, roles.
    expect(DEFAULT_ROW_LAYOUT[2]).toEqual(['top-maps', 'top-heroes', 'top-roles'])
  })
})
