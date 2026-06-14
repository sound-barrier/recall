import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import type { MatchRecord } from '@/api'
import type { SearchClause } from '@/match/search-query'

// Stub the reference-data singleton so the row renders deterministically
// without firing the once-per-session fetch (which would ECONNREFUSED in
// the test env). role() returns '' → the row falls back to the stored
// role, which is all these assertions exercise.
vi.mock('@/composables/shared/useOWData', async () => {
  const { computed } = await import('vue')
  return {
    useOWData: () => ({
      data: computed(() => null),
      mapIndex: computed(() => new Map()),
      heroIndex: computed(() => new Map()),
      mapDisplayName: (s: string | null | undefined) => s ?? '',
      heroDisplayName: (s: string | null | undefined) => s ?? '',
      heroRole: () => '',
      mapGameMode: () => '',
    }),
  }
})

const { default: MatchTableRow } = await import('@/components/matches/MatchTableRow.vue')

function rec(over: Partial<MatchRecord['data']> = {}, key = 'm-1'): MatchRecord {
  return {
    match_key: key,
    source_files: [`${key}.png`],
    data: {
      map: 'rialto',
      playlist: 'competitive',
      hero: 'lucio',
      role: 'support',
      result: 'victory',
      eliminations: 20,
      assists: 10,
      deaths: 8,
      ...over,
    },
    parsed_at: '2026-05-10T22:30:00Z',
  } as unknown as MatchRecord
}

function mountRow(props: Partial<Record<string, unknown>> = {}) {
  return mount(MatchTableRow, {
    props: {
      rec: rec(),
      cardIndex: 0,
      focusedCardIndex: -1,
      selected: false,
      hasSelection: false,
      isAnchor: false,
      searchClauses: [] as SearchClause[],
      ...props,
    },
  })
}

describe('MatchTableRow', () => {
  it('renders a <tr> carrying the keyboard-nav data attributes', () => {
    const w = mountRow({ cardIndex: 3 })
    const tr = w.find('tr.table-row')
    expect(tr.exists()).toBe(true)
    expect(tr.attributes('data-match-key')).toBe('m-1')
    expect(tr.attributes('data-card-index')).toBe('3')
  })

  it('renders the map, E/A/D, and a result chip tinted by outcome', () => {
    const w = mountRow({ rec: rec({ result: 'defeat' }) })
    expect(w.find('.tc-map').text()).toContain('rialto')
    expect(w.find('.tc-stats').text().replace(/\s+/g, '')).toBe('20/10/8')
    const chip = w.find('.tc-result-chip')
    expect(chip.classes()).toContain('result-defeat')
  })

  it('emits open-match with the key when the row is clicked', async () => {
    const w = mountRow()
    await w.find('tr.table-row').trigger('click')
    expect(w.emitted('open-match')?.[0]).toEqual(['m-1'])
  })

  it('emits toggle-select (and not open-match) when the checkbox is clicked', async () => {
    const w = mountRow()
    await w.find('.leaf-checkbox').trigger('click')
    expect(w.emitted('toggle-select')?.[0]).toEqual(['m-1'])
    expect(w.emitted('open-match')).toBeUndefined()
  })

  it('marks aria-current when the row is the keyboard-focused card', () => {
    const focused = mountRow({ cardIndex: 2, focusedCardIndex: 2 })
    expect(focused.find('tr.table-row').attributes('aria-current')).toBe('true')
    const unfocused = mountRow({ cardIndex: 2, focusedCardIndex: 5 })
    expect(unfocused.find('tr.table-row').attributes('aria-current')).toBeUndefined()
  })

  it('highlights a bare-term hit in the map cell via <mark class="search-hl">', () => {
    const w = mountRow({ searchClauses: [{ field: null, value: 'rialto' }] satisfies SearchClause[] })
    const mark = w.find('.tc-map mark.search-hl')
    expect(mark.exists()).toBe(true)
    expect(mark.text()).toBe('rialto')
  })

  it('renders tag chips with a leading # and highlights a tag-scoped hit', () => {
    const w = mount(MatchTableRow, {
      props: {
        rec: {
          match_key: 'm-tag',
          source_files: ['m-tag.png'],
          data: rec().data,
          parsed_at: '2026-05-10T22:30:00Z',
          annotation: { tags: ['clutch'] },
        } as unknown as MatchRecord,
        cardIndex: 0,
        selected: false,
        hasSelection: false,
        isAnchor: false,
        searchClauses: [{ field: 'tag', value: 'clutch' }] satisfies SearchClause[],
      },
    })
    expect(w.find('.tc-tags').text()).toContain('#clutch')
    expect(w.find('.tc-tags mark.search-hl').text()).toBe('clutch')
  })
})
