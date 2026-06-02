import { describe, it, expect } from 'vitest'
import {
  WIDGET_REGISTRY,
  DEFAULT_ROW_LAYOUT,
  widgetById,
} from './widgets'

describe('dashboard widget registry', () => {
  it('every registry id appears in exactly one default row', () => {
    const registryIds = new Set(WIDGET_REGISTRY.map((w) => w.id))
    const layoutCounts = new Map<string, number>()
    for (const row of Object.values(DEFAULT_ROW_LAYOUT)) {
      for (const id of row) {
        layoutCounts.set(id, (layoutCounts.get(id) ?? 0) + 1)
      }
    }
    for (const id of registryIds) {
      expect(layoutCounts.get(id), `${id} should appear in exactly one row`).toBe(1)
    }
    // No layout entry references a widget the registry doesn't ship.
    for (const id of layoutCounts.keys()) {
      expect(registryIds.has(id), `layout references unknown widget ${id}`).toBe(true)
    }
  })

  it('every widget has a unique kebab-case id', () => {
    const ids = WIDGET_REGISTRY.map((w) => w.id)
    expect(new Set(ids).size, 'duplicate widget ids').toBe(ids.length)
    for (const id of ids) {
      expect(id, `${id} must be lowercase kebab-case`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    }
  })

  it('each widget declares a shape and defaultRow that match its layout placement', () => {
    for (const w of WIDGET_REGISTRY) {
      expect(w.shape === 'kpi' || w.shape === 'breakdown', `${w.id} shape`).toBe(true)
      expect(DEFAULT_ROW_LAYOUT[w.defaultRow], `${w.id} declares defaultRow ${w.defaultRow} but no such row exists`).toBeDefined()
      expect(DEFAULT_ROW_LAYOUT[w.defaultRow]?.includes(w.id), `${w.id} declares defaultRow ${w.defaultRow} but isn't in it`).toBe(true)
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
