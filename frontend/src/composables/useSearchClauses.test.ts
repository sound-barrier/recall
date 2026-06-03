import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useSearchClauses } from './useSearchClauses'

describe('useSearchClauses', () => {
  it('returns an empty array for empty input', () => {
    const src = ref('')
    const { searchClauses } = useSearchClauses(src)
    expect(searchClauses.value).toEqual([])
  })

  it('parses a bare term as a clause with field=null', () => {
    const src = ref('lucio')
    const { searchClauses } = useSearchClauses(src)
    expect(searchClauses.value).toEqual([{ field: null, value: 'lucio' }])
  })

  it('parses field-scoped clauses', () => {
    const src = ref('note:practice tag:stack')
    const { searchClauses } = useSearchClauses(src)
    expect(searchClauses.value).toContainEqual({ field: 'note', value: 'practice' })
    expect(searchClauses.value).toContainEqual({ field: 'tag', value: 'stack' })
  })

  it('reacts to source ref changes', () => {
    const src = ref('a')
    const { searchClauses } = useSearchClauses(src)
    expect(searchClauses.value).toHaveLength(1)
    src.value = 'a b'
    expect(searchClauses.value).toHaveLength(2)
    src.value = ''
    expect(searchClauses.value).toEqual([])
  })
})
