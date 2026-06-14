import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'

import HighlightedText from '@/components/matches/HighlightedText.vue'

describe('HighlightedText', () => {
  it('wraps a case-insensitive hit in <mark class="search-hl">, preserving the original case', () => {
    const w = mount(HighlightedText, { props: { text: 'Rialto', terms: ['rialto'] } })
    const mark = w.find('mark.search-hl')
    expect(mark.exists()).toBe(true)
    expect(mark.text()).toBe('Rialto')
  })

  it('renders plain text (no marks) when no term hits', () => {
    const w = mount(HighlightedText, { props: { text: 'numbani', terms: ['rialto'] } })
    expect(w.find('mark').exists()).toBe(false)
    expect(w.text()).toBe('numbani')
  })

  it('renders plain text when there are no terms', () => {
    const w = mount(HighlightedText, { props: { text: 'lucio', terms: [] } })
    expect(w.find('mark').exists()).toBe(false)
    expect(w.text()).toBe('lucio')
  })

  it('splits a partial hit without gaining stray whitespace', () => {
    const w = mount(HighlightedText, { props: { text: 'rialto', terms: ['rial'] } })
    expect(w.find('mark.search-hl').text()).toBe('rial')
    expect(w.text()).toBe('rialto')
  })
})
