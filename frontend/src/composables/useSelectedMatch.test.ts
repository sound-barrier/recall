import { describe, it, expect } from 'vitest'
import { ref, nextTick } from 'vue'
import type { MatchRecord } from '@/api'
import { useSelectedMatch } from '@/composables/useSelectedMatch'

function rec(k: string): MatchRecord {
  return {
    match_key: k,
    source_files: [`${k}.png`],
    data: { map: 'rialto' },
  }
}

describe('useSelectedMatch', () => {
  it('starts closed with no selection', () => {
    const list = ref<MatchRecord[]>([rec('a'), rec('b')])
    const s = useSelectedMatch(list)
    expect(s.isOpen.value).toBe(false)
    expect(s.selectedKey.value).toBe('')
    expect(s.selectedRecord.value).toBeNull()
    expect(s.selectedIndex.value).toBe(-1)
  })

  it('open() selects + isOpen becomes true', () => {
    const list = ref<MatchRecord[]>([rec('a'), rec('b'), rec('c')])
    const s = useSelectedMatch(list)
    s.open('b')
    expect(s.isOpen.value).toBe(true)
    expect(s.selectedKey.value).toBe('b')
    expect(s.selectedIndex.value).toBe(1)
    expect(s.selectedRecord.value?.match_key).toBe('b')
  })

  it('close() clears selection', () => {
    const list = ref<MatchRecord[]>([rec('a')])
    const s = useSelectedMatch(list)
    s.open('a')
    s.close()
    expect(s.isOpen.value).toBe(false)
    expect(s.selectedKey.value).toBe('')
  })

  it('canPrev / canNext reflect the position in the filtered list', () => {
    const list = ref<MatchRecord[]>([rec('a'), rec('b'), rec('c')])
    const s = useSelectedMatch(list)
    s.open('a')
    expect(s.canPrev.value).toBe(false)
    expect(s.canNext.value).toBe(true)
    s.open('b')
    expect(s.canPrev.value).toBe(true)
    expect(s.canNext.value).toBe(true)
    s.open('c')
    expect(s.canPrev.value).toBe(true)
    expect(s.canNext.value).toBe(false)
  })

  it('openPrev / openNext step through the list', () => {
    const list = ref<MatchRecord[]>([rec('a'), rec('b'), rec('c')])
    const s = useSelectedMatch(list)
    s.open('b')
    s.openPrev()
    expect(s.selectedKey.value).toBe('a')
    s.openNext()
    expect(s.selectedKey.value).toBe('b')
    s.openNext()
    expect(s.selectedKey.value).toBe('c')
  })

  it('openPrev at index 0 is a no-op', () => {
    const list = ref<MatchRecord[]>([rec('a'), rec('b')])
    const s = useSelectedMatch(list)
    s.open('a')
    s.openPrev()
    expect(s.selectedKey.value).toBe('a')
  })

  it('openNext at the end is a no-op', () => {
    const list = ref<MatchRecord[]>([rec('a'), rec('b')])
    const s = useSelectedMatch(list)
    s.open('b')
    s.openNext()
    expect(s.selectedKey.value).toBe('b')
  })

  it('auto-closes when the selected match leaves the filtered list', async () => {
    const list = ref<MatchRecord[]>([rec('a'), rec('b'), rec('c')])
    const s = useSelectedMatch(list)
    s.open('b')
    expect(s.isOpen.value).toBe(true)

    list.value = [rec('a'), rec('c')] // 'b' removed by a filter
    await nextTick()
    expect(s.isOpen.value).toBe(false)
    expect(s.selectedKey.value).toBe('')
  })

  it('stays open when the list reorders but still contains the selection', async () => {
    const list = ref<MatchRecord[]>([rec('a'), rec('b'), rec('c')])
    const s = useSelectedMatch(list)
    s.open('b')

    list.value = [rec('c'), rec('b'), rec('a')] // sort flipped, b still present
    await nextTick()
    expect(s.isOpen.value).toBe(true)
    expect(s.selectedKey.value).toBe('b')
    expect(s.selectedIndex.value).toBe(1)
  })
})
