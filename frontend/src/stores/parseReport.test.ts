import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useParseReportStore } from '@/stores/parseReport'

describe('useParseReportStore', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('opens on the given candidates and closes again', () => {
    const store = useParseReportStore()

    store.openReport([{ filename: 'a.png', dirId: 1 }])
    expect(store.open).toBe(true)
    expect(store.candidates).toEqual([{ filename: 'a.png', dirId: 1 }])

    store.closeReport()
    expect(store.open).toBe(false)
  })

  it('ignores an open with nothing to report', () => {
    const store = useParseReportStore()

    store.openReport([])

    expect(store.open).toBe(false)
  })
})
