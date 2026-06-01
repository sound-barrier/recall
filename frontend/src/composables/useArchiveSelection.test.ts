import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
import type { MatchRecord } from '../api'

import { useArchiveSelection } from './useArchiveSelection'

function rec(matchKey: string, hidden = false): MatchRecord {
  return {
    match_key: matchKey,
    source_files: [],
    data: {},
    parsed_at: '',
    ...(hidden ? { hidden: true } : {}),
  }
}

function setup(records: MatchRecord[]) {
  const onUnhideMatches = vi.fn()
  const onHardDeleteMatches = vi.fn()
  const api = useArchiveSelection({
    records: ref(records),
    onUnhideMatches,
    onHardDeleteMatches,
  })
  return { api, onUnhideMatches, onHardDeleteMatches }
}

describe('useArchiveSelection', () => {
  it('hiddenRecords filters to r.hidden === true', () => {
    const { api } = setup([
      rec('a', true),
      rec('b', false),
      rec('c', true),
    ])
    expect(api.hiddenRecords.value.map((r) => r.match_key)).toEqual(['a', 'c'])
  })

  it('visibleRecords filters to NOT r.hidden', () => {
    const { api } = setup([
      rec('a', true),
      rec('b', false),
      rec('c', true),
      rec('d', false),
    ])
    expect(api.visibleRecords.value.map((r) => r.match_key)).toEqual(['b', 'd'])
  })

  it('toggleArchiveSelected flips a key in and out of the set', () => {
    const { api } = setup([rec('a', true)])
    api.toggleArchiveSelected('a')
    expect(api.archiveSelectedKeys.value.has('a')).toBe(true)
    api.toggleArchiveSelected('a')
    expect(api.archiveSelectedKeys.value.has('a')).toBe(false)
  })

  it('selectAllArchive ticks every hidden row', () => {
    const { api } = setup([
      rec('a', true),
      rec('b', false),
      rec('c', true),
    ])
    api.selectAllArchive()
    expect([...api.archiveSelectedKeys.value].sort()).toEqual(['a', 'c'])
  })

  it('toggleArchiveSelected aborts any armed bulk-confirm', () => {
    const { api } = setup([rec('a', true), rec('b', true)])
    api.toggleArchiveSelected('a')
    api.requestBulkHardDelete()
    expect(api.archiveBulkConfirm.value).toBe(true)
    api.toggleArchiveSelected('b')
    expect(api.archiveBulkConfirm.value).toBe(false)
  })

  it('clearArchiveSelection wipes selection AND bulk-confirm', () => {
    const { api } = setup([rec('a', true)])
    api.toggleArchiveSelected('a')
    api.requestBulkHardDelete()
    api.clearArchiveSelection()
    expect(api.archiveSelectedKeys.value.size).toBe(0)
    expect(api.archiveBulkConfirm.value).toBe(false)
  })

  it('unhideSelectedArchive fires the emit with the keys + clears', () => {
    const { api, onUnhideMatches } = setup([rec('a', true), rec('b', true)])
    api.toggleArchiveSelected('a')
    api.toggleArchiveSelected('b')
    api.unhideSelectedArchive()
    expect(onUnhideMatches).toHaveBeenCalledWith(['a', 'b'])
    expect(api.archiveSelectedKeys.value.size).toBe(0)
  })

  it('unhideSelectedArchive is a no-op on empty selection', () => {
    const { api, onUnhideMatches } = setup([])
    api.unhideSelectedArchive()
    expect(onUnhideMatches).not.toHaveBeenCalled()
  })

  it('requestBulkHardDelete + commitBulkHardDelete fires the emit', () => {
    const { api, onHardDeleteMatches } = setup([rec('a', true)])
    api.toggleArchiveSelected('a')
    api.requestBulkHardDelete()
    expect(api.archiveBulkConfirm.value).toBe(true)
    api.commitBulkHardDelete()
    expect(onHardDeleteMatches).toHaveBeenCalledWith(['a'])
    expect(api.archiveSelectedKeys.value.size).toBe(0)
  })

  it('cancelBulkHardDelete clears the confirm without firing', () => {
    const { api, onHardDeleteMatches } = setup([rec('a', true)])
    api.toggleArchiveSelected('a')
    api.requestBulkHardDelete()
    api.cancelBulkHardDelete()
    expect(api.archiveBulkConfirm.value).toBe(false)
    expect(onHardDeleteMatches).not.toHaveBeenCalled()
  })

  it('confirmHardDelete / cancelHardDelete drive the per-row two-step', () => {
    const { api } = setup([rec('a', true)])
    api.confirmHardDelete('a')
    expect(api.archiveConfirmKey.value).toBe('a')
    api.cancelHardDelete()
    expect(api.archiveConfirmKey.value).toBeNull()
  })
})
