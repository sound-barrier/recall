import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import MatchCard from './MatchCard.vue'
import type { MatchRecord } from '../api'

// MatchCard fixtures. Each test asserts on either rendered DOM or
// emitted events. The isActive predicate is the only callback the
// component needs from outside; it always returns false here unless
// a test pins specific filters.

function makeRecord(over: Partial<MatchRecord['data']> = {}, recOver: Partial<MatchRecord> = {}): MatchRecord {
  return {
    id: 1,
    match_key: 'match:2026-05-10T21:29:28',
    source_files: ['summary.png', 'scoreboard.png'],
    source_types: { 'summary.png': 'summary', 'scoreboard.png': 'scoreboard' },
    data: {
      map: 'rialto',
      mode: 'competitive',
      type: 'control',
      role: 'support',
      hero: 'lucio',
      result: 'victory',
      date: '2026-05-10',
      finished_at: '21:29',
      game_length: '11:25',
      final_score: '3-1',
      eliminations: 17,
      assists: 16,
      deaths: 11,
      damage: 7200,
      healing: 4800,
      mitigation: 0,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:25', stats: { weapon_accuracy: 24 } }],
      ...over,
    },
    ...recOver,
  }
}

function mountCard(over: Partial<Record<string, unknown>> = {}) {
  return mount(MatchCard, {
    props: {
      record: over.record ?? makeRecord(),
      index: 0,
      isExpanded: false,
      isSourcesOpen: false,
      previewOpen: {},
      previewError: {},
      isActive: () => false,
      ...over,
    },
  })
}

describe('MatchCard — collapsed header', () => {
  it('renders the match index zero-padded', () => {
    expect(mountCard({ index: 0 }).find('.match-index').text()).toBe('01')
    expect(mountCard({ index: 11 }).find('.match-index').text()).toBe('12')
  })

  it('shows the map name in the header', () => {
    const wrapper = mountCard()
    expect(wrapper.find('.match-map').text()).toBe('rialto')
  })

  it('falls back to "Unknown Map" when data.map is empty', () => {
    const wrapper = mountCard({ record: makeRecord({ map: '' }) })
    expect(wrapper.find('.match-map').text()).toBe('Unknown Map')
  })

  it('shows formatted time and game length', () => {
    const wrapper = mountCard()
    expect(wrapper.find('.when').text()).toMatch(/May 10, 2026.*9:29pm/)
    expect(wrapper.find('.length').text()).toContain('11:25')
  })

  it('renders mode / type / role / hero / result badges', () => {
    const wrapper = mountCard()
    const text = wrapper.text()
    expect(text).toContain('competitive')
    expect(text).toContain('control')
    expect(text).toContain('support')
    expect(text).toContain('lucio')
    expect(text).toContain('victory')
  })

  it('applies result-{result} class to the article root', () => {
    expect(mountCard().find('article').classes()).toContain('result-victory')
    expect(mountCard({ record: makeRecord({ result: 'defeat' }) }).find('article').classes()).toContain('result-defeat')
  })

  it('applies "active" class to a badge when its filter is set', () => {
    const isActive = (field: string, value: string) => field === 'map' && value === 'rialto'
    const wrapper = mountCard({ isActive })
    expect(wrapper.find('.match-map').classes()).toContain('active')
  })

  it('shows the incomplete badge when required slots are missing', () => {
    // source_types only has TEAMS (scoreboard) → SUMMARY + PERSONAL are
    // missing. The incomplete badge should appear.
    const rec = makeRecord({}, {
      source_files: ['scoreboard.png'],
      source_types: { 'scoreboard.png': 'scoreboard' },
    })
    const wrapper = mountCard({ record: rec })
    expect(wrapper.find('.incomplete-badge').exists()).toBe(true)
    expect(wrapper.find('.incomplete-badge').text()).toContain('SUMMARY')
  })
})

describe('MatchCard — filter-toggle emits from badge clicks', () => {
  it('clicking the map badge emits filter-toggle map', async () => {
    const wrapper = mountCard()
    await wrapper.find('.match-map').trigger('click')
    expect(wrapper.emitted('filter-toggle')![0]).toEqual(['map', 'rialto'])
  })

  it('clicking the mode badge emits filter-toggle mode', async () => {
    const wrapper = mountCard()
    await wrapper.find('.badge.mode').trigger('click')
    expect(wrapper.emitted('filter-toggle')![0]).toEqual(['mode', 'competitive'])
  })

  it('clicking the hero badge emits filter-toggle hero', async () => {
    const wrapper = mountCard()
    await wrapper.find('.badge.hero').trigger('click')
    expect(wrapper.emitted('filter-toggle')![0]).toEqual(['hero', 'lucio'])
  })

  it('clicking the result badge emits filter-toggle result', async () => {
    const wrapper = mountCard()
    await wrapper.find('.badge.result').trigger('click')
    expect(wrapper.emitted('filter-toggle')![0]).toEqual(['result', 'victory'])
  })
})

describe('MatchCard — header interaction', () => {
  it('clicking the header emits toggle-expand', async () => {
    const wrapper = mountCard()
    await wrapper.find('.match-header').trigger('click')
    expect(wrapper.emitted('toggle-expand')).toBeTruthy()
  })

  it('Enter / Space on the header emits toggle-expand', async () => {
    const wrapper = mountCard()
    await wrapper.find('.match-header').trigger('keydown.enter')
    expect(wrapper.emitted('toggle-expand')).toHaveLength(1)
  })

  it('aria-expanded mirrors the isExpanded prop', () => {
    const open = mountCard({ isExpanded: true })
    expect(open.find('.match-header').attributes('aria-expanded')).toBe('true')
    const closed = mountCard({ isExpanded: false })
    expect(closed.find('.match-header').attributes('aria-expanded')).toBe('false')
  })
})

describe('MatchCard — expanded body', () => {
  it('renders six stat cells when expanded', () => {
    const wrapper = mountCard({ isExpanded: true })
    const stats = wrapper.findAll('.stat')
    expect(stats).toHaveLength(6)
    // Damage formats with thousands separator.
    const damage = stats.find(s => s.text().includes('Damage'))!
    expect(damage.text()).toContain('7,200')
  })

  it('renders the Final Score meta when present', () => {
    const wrapper = mountCard({ isExpanded: true })
    expect(wrapper.find('.meta-eyebrow').text()).toBe('Final Score')
    expect(wrapper.find('.meta-value').text()).toBe('3-1')
  })

  it('renders heroes_played list with percent + play time + stats', () => {
    const wrapper = mountCard({ isExpanded: true })
    expect(wrapper.find('.hero-pct').text()).toBe('100%')
    expect(wrapper.find('.hero-time').text()).toBe('11:25')
    expect(wrapper.text()).toContain('weapon accuracy')
    expect(wrapper.text()).toContain('24')
  })

  it('renders the rank block with tier + progress + SR deltas', () => {
    const rec = makeRecord({
      rank: 'platinum', level: 3, rank_progress: 40, change_percent: 5,
      modifiers: ['expected', 'victory'],
      sr: [
        { hero: 'lucio', sr: 3200, change: 30 },
        { hero: 'kiriko', sr: 3100, change: -10 },
      ],
    })
    const wrapper = mountCard({ record: rec, isExpanded: true })
    expect(wrapper.find('.rank-tier').text()).toBe('platinum 3')
    expect(wrapper.find('.rank-progress').text()).toContain('40%')
    expect(wrapper.find('.rank-change').text()).toContain('+5%')
    const srEntries = wrapper.findAll('.sr-entry')
    expect(srEntries).toHaveLength(2)
    expect(srEntries[0]!.find('.sr-delta').classes()).toContain('up')
    expect(srEntries[1]!.find('.sr-delta').classes()).toContain('down')
  })
})

describe('MatchCard — sources panel', () => {
  it('renders the sources toggle with file count', () => {
    const wrapper = mountCard({ isExpanded: true })
    expect(wrapper.find('.sources-count').text()).toBe('2')
  })

  it('emits toggle-sources when the sources toggle is clicked', async () => {
    const wrapper = mountCard({ isExpanded: true })
    await wrapper.find('.sources-toggle').trigger('click')
    expect(wrapper.emitted('toggle-sources')).toBeTruthy()
  })

  it('renders the source-file list only when isSourcesOpen=true', () => {
    const closed = mountCard({ isExpanded: true, isSourcesOpen: false })
    expect(closed.findAll('.source-file')).toHaveLength(0)
    const open = mountCard({ isExpanded: true, isSourcesOpen: true })
    expect(open.findAll('.source-file')).toHaveLength(2)
  })

  it('source-type chips render from source_types map', () => {
    const wrapper = mountCard({ isExpanded: true, isSourcesOpen: true })
    const labels = wrapper.findAll('.source-type-chip').map(el => el.text())
    expect(labels).toContain('SUMMARY')
    expect(labels).toContain('TEAMS') // scoreboard → TEAMS
  })

  it('renders "?" chip when source_types missing for a file', () => {
    const rec = makeRecord({}, {
      source_files: ['mystery.png'],
      source_types: undefined,
    })
    const wrapper = mountCard({ record: rec, isExpanded: true, isSourcesOpen: true })
    const unknownChip = wrapper.find('.source-type-chip.unknown')
    expect(unknownChip.exists()).toBe(true)
    expect(unknownChip.text()).toBe('?')
  })

  it('clicking a source filename emits toggle-preview', async () => {
    const wrapper = mountCard({ isExpanded: true, isSourcesOpen: true })
    await wrapper.findAll('.source-name')[0]!.trigger('click')
    expect(wrapper.emitted('toggle-preview')![0]).toEqual(['summary.png'])
  })

  it('renders <img> when previewOpen[file]=true and no error', () => {
    const wrapper = mountCard({
      isExpanded: true,
      isSourcesOpen: true,
      previewOpen: { 'summary.png': true },
      previewError: {},
    })
    const imgs = wrapper.findAll('img.source-preview')
    expect(imgs).toHaveLength(1)
    expect(imgs[0]!.attributes('src')).toBe('/_screenshot/summary.png')
  })

  it('renders preview error message when previewError[file]=true', () => {
    const wrapper = mountCard({
      isExpanded: true,
      isSourcesOpen: true,
      previewOpen: { 'summary.png': true },
      previewError: { 'summary.png': true },
    })
    expect(wrapper.find('.source-preview-error').exists()).toBe(true)
  })

  it('img @error emits preview-error', async () => {
    const wrapper = mountCard({
      isExpanded: true,
      isSourcesOpen: true,
      previewOpen: { 'summary.png': true },
    })
    await wrapper.find('img.source-preview').trigger('error')
    expect(wrapper.emitted('preview-error')![0]).toEqual(['summary.png'])
  })

  it('shows the "missing required" explainer when sources open and slots are absent', () => {
    const rec = makeRecord({}, {
      source_files: ['scoreboard.png'],
      source_types: { 'scoreboard.png': 'scoreboard' },
    })
    const wrapper = mountCard({ record: rec, isExpanded: true, isSourcesOpen: true })
    const explain = wrapper.find('.sources-explain')
    expect(explain.exists()).toBe(true)
    expect(explain.text()).toContain('SUMMARY missing')
  })
})
