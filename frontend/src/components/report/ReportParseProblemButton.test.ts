import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { createPinia, setActivePinia } from 'pinia'

import ReportParseProblemButton from '@/components/report/ReportParseProblemButton.vue'
import { useParseReportStore } from '@/stores/parseReport'

describe('ReportParseProblemButton', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('opens the report on every source file, each with its folder', async () => {
    render(ReportParseProblemButton, {
      props: { record: { source_files: ['a.png', 'b.png'], source_dir_ids: { 'a.png': 2, 'b.png': 2 } } },
    })

    await userEvent.setup().click(screen.getByRole('button', { name: 'Report parse problem…' }))

    const store = useParseReportStore()
    expect(store.open).toBe(true)
    expect(store.candidates).toEqual([{ filename: 'a.png', dirId: 2 }, { filename: 'b.png', dirId: 2 }])
  })

  it('opens nothing for a record with no screenshots', async () => {
    render(ReportParseProblemButton, { props: { record: { source_files: [] } } })

    await userEvent.setup().click(screen.getByRole('button', { name: 'Report parse problem…' }))

    expect(useParseReportStore().open).toBe(false)
  })
})
