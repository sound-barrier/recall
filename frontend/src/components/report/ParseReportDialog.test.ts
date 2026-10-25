import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

import ParseReportDialog from '@/components/report/ParseReportDialog.vue'
import { ExportDiagnosticBundle, OpenURL, PreflightDiagnosticBundle } from '@/api'
import type { LikelyCause } from '@/api'
import { useAppStore } from '@/stores/app'
import { useParseReportStore } from '@/stores/parseReport'
import type { ReportCandidate } from '@/components/report/parse-report'

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  PreflightDiagnosticBundle: vi.fn(async (): Promise<LikelyCause[]> => []),
  ExportDiagnosticBundle:    vi.fn(async () => 'recall-diagnostic-x.zip'),
  OpenURL:                   vi.fn(async () => undefined),
}))

afterEach(() => { vi.clearAllMocks() })

const A: ReportCandidate = { filename: 'a.png', dirId: 0 }
const B: ReportCandidate = { filename: 'b.png', dirId: 2 }

async function openWith(candidates: ReportCandidate[]) {
  setActivePinia(createPinia())
  render(ParseReportDialog)
  useParseReportStore().openReport(candidates)
  await nextTick()
  await new Promise((r) => setTimeout(r))
}

const user = () => userEvent.setup()
const saveButton = () => screen.getByRole('button', { name: 'Save report…' })

describe('ParseReportDialog', () => {
  it('starts with every candidate ticked and a note box for each', async () => {
    await openWith([A, B])

    expect(screen.getByRole('dialog', { name: 'Report a parse problem' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Include a.png' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Include b.png' })).toBeChecked()
    expect(screen.getByRole('textbox', { name: 'What’s wrong with a.png?' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'What’s wrong with b.png?' })).toBeInTheDocument()
  })

  it('shows setup causes up top and file causes under their file', async () => {
    vi.mocked(PreflightDiagnosticBundle).mockResolvedValueOnce([
      { code: 'tesseract_unsupported', message: 'Tesseract 4 is too old.' },
      { code: 'unusual_aspect_ratio', filename: 'a.png', message: 'a.png is not 16:9.' },
    ])
    await openWith([A])

    const setup = screen.getByRole('region', { name: 'Check this first' })
    expect(setup).toHaveTextContent('Tesseract 4 is too old.')
    expect(setup).not.toHaveTextContent('a.png is not 16:9.')
    expect(screen.getByText('a.png is not 16:9.')).toBeInTheDocument()
  })

  it('stays usable when the preflight check fails', async () => {
    vi.mocked(PreflightDiagnosticBundle).mockRejectedValueOnce(new Error('offline'))
    await openWith([A])

    expect(screen.queryByRole('region', { name: 'Check this first' })).not.toBeInTheDocument()
    expect(saveButton()).toBeEnabled()
  })

  it('saves only the ticked files, each with its note', async () => {
    await openWith([A, B])

    await user().click(screen.getByRole('checkbox', { name: 'Include b.png' }))
    expect(screen.queryByRole('textbox', { name: 'What’s wrong with b.png?' })).not.toBeInTheDocument()
    await user().type(screen.getByRole('textbox', { name: 'What’s wrong with a.png?' }), ' hero should be Kiriko ')
    await user().click(saveButton())

    expect(ExportDiagnosticBundle).toHaveBeenCalledWith([
      { filename: 'a.png', screenshots_dir_id: 0, note: 'hero should be Kiriko' },
    ])
    expect(screen.getByRole('status')).toHaveTextContent('Saved recall-diagnostic-x.zip')
  })

  it('opens a prefilled parse-problem issue after saving', async () => {
    await openWith([A])

    await user().click(saveButton())
    await user().click(screen.getByRole('button', { name: 'Open a GitHub issue' }))

    const url = new URL(vi.mocked(OpenURL).mock.calls[0]?.[0] ?? '')
    expect(url.pathname).toBe('/sound-barrier/recall/issues/new')
    expect(url.searchParams.get('template')).toBe('parse_problem.yml')
    expect(url.searchParams.get('files')).toContain('a.png')
  })

  it('stays quiet when the save dialog is canceled', async () => {
    vi.mocked(ExportDiagnosticBundle).mockResolvedValueOnce('')
    await openWith([A])

    await user().click(saveButton())

    expect(screen.queryByText(/Saved/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open a GitHub issue' })).not.toBeInTheDocument()
  })

  it('reports a failed save on the error banner', async () => {
    vi.mocked(ExportDiagnosticBundle).mockRejectedValueOnce(new Error('disk full'))
    await openWith([A])

    await user().click(saveButton())

    expect(useAppStore().error).toContain('disk full')
  })

  it('blocks saving with nothing ticked, and says why', async () => {
    await openWith([A])

    await user().click(screen.getByRole('checkbox', { name: 'Include a.png' }))

    expect(saveButton()).toBeDisabled()
    expect(saveButton()).toHaveAccessibleDescription('Tick at least one screenshot to report.')
  })

  it('warns when the pick is too big for one GitHub attachment', async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ filename: `s${i}.png`, dirId: 0 }))
    await openWith(many)

    expect(screen.getByText(/GitHub takes attachments up to 25 MB/)).toBeInTheDocument()
  })

  it('closes on Cancel', async () => {
    await openWith([A])

    await user().click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
