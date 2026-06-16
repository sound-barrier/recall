import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import MatchProvenanceBadge from '@/components/matches/shared/MatchProvenanceBadge.vue'

describe('MatchProvenanceBadge', () => {
  it('defaults to OCR when source is absent', () => {
    const w = mount(MatchProvenanceBadge, { props: {} })
    expect(w.text()).toContain('OCR')
    expect(w.attributes('aria-label')).toContain('Source: OCR')
  })

  it('shows Edited with the edited-field count in the tooltip', () => {
    const w = mount(MatchProvenanceBadge, {
      props: { source: 'ocr_edited', editedFields: ['data.map', 'data.damage'] },
    })
    expect(w.text()).toContain('Edited')
    expect(w.attributes('title')).toContain('2 fields')
  })

  it('singularises a single edited field', () => {
    const w = mount(MatchProvenanceBadge, {
      props: { source: 'ocr_edited', editedFields: ['data.map'] },
    })
    expect(w.attributes('title')).toContain('1 field')
    expect(w.attributes('title')).not.toContain('1 fields')
  })

  it('shows "User entered" for a hand-entered match', () => {
    const w = mount(MatchProvenanceBadge, { props: { source: 'manual' } })
    expect(w.text()).toContain('User entered')
    expect(w.attributes('aria-label')).toContain('Hand-entered')
  })

  it('hides the text label in compact mode but keeps the aria-label', () => {
    const w = mount(MatchProvenanceBadge, { props: { source: 'manual', compact: true } })
    expect(w.text()).not.toContain('User entered')
    expect(w.attributes('aria-label')).toContain('User entered')
  })
})
