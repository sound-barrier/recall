import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { createPinia, setActivePinia } from 'pinia'

import UnknownFailedSection from '@/components/unknown/UnknownFailedSection.vue'
import { useMatchesStore } from '@/stores/matches'
import { qk } from '@/queries/keys'
import { seedQuery } from '@/test-utils/queryTestUtils'
import { ExportDiagnosticBundle, IgnoreScreenshot } from '@/api'
import type { FailedFile } from '@/api'

// The section reads matchesStore.failedFiles directly and suppresses via
// useMatchActions' onIgnoreScreenshot. Keep '@/api' real except the calls
// the store's reload paths + the ignore action would hit.
vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  GetMatchResults:        vi.fn(async () => []),
  GetNewScreenshotCount:  vi.fn(async () => ({ count: 0, parked: 0 })),
  GetFailedFiles:         vi.fn(async () => []),
  GetIgnoredScreenshots:  vi.fn(async () => []),
  IgnoreScreenshot:       vi.fn(async () => undefined),
  ExportDiagnosticBundle: vi.fn(async () => 'recall-diagnostic-x.zip'),
}))

afterEach(() => {
  vi.clearAllMocks()
})

const row = (over: Partial<FailedFile> = {}): FailedFile => ({
  filename: 'corrupt.png',
  error: 'decoding image: png: invalid format',
  attempts: 6,
  parked: false,
  first_failed_at: '2026-07-01T20:00:00Z',
  last_failed_at: '2026-07-06T21:30:00Z',
  ...over,
})

function renderWith(rows: FailedFile[]) {
  setActivePinia(createPinia())
  // Seed BEFORE the store exists: pre-seeded data is fresh (staleTime is
  // Infinity), so the store's observer never fires the initial fetch that
  // would otherwise clobber the seed when its mock resolves.
  seedQuery(qk.failedFiles, rows)
  useMatchesStore()
  return render(UnknownFailedSection)
}

const user = () => userEvent.setup()

describe('UnknownFailedSection', () => {
  it('renders nothing when the ledger is empty', () => {
    renderWith([])
    expect(screen.queryByRole('heading', { name: /Failed to read/ })).not.toBeInTheDocument()
  })

  it('lists filename, error, and attempt tally', () => {
    renderWith([row()])
    expect(screen.getByRole('heading', { name: 'Failed to read (1)' })).toBeInTheDocument()
    expect(screen.getByText('corrupt.png')).toBeInTheDocument()
    expect(screen.getByText(/decoding image: png: invalid format/)).toBeInTheDocument()
    expect(screen.getByText(/6 attempts/)).toBeInTheDocument()
    expect(screen.getByText(/retried on every parse run/i)).toBeInTheDocument()
  })

  it('the bundle button calls the export and reports the saved name', async () => {
    renderWith([row()])
    await user().click(screen.getByRole('button', { name: 'Save diagnostic bundle' }))
    await new Promise((r) => setTimeout(r))
    expect(ExportDiagnosticBundle).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/Saved recall-diagnostic-x\.zip/)).toBeInTheDocument()
  })

  it('a Wails dialog cancel (empty name) stays silent', async () => {
    vi.mocked(ExportDiagnosticBundle).mockResolvedValueOnce('')
    renderWith([row()])
    await user().click(screen.getByRole('button', { name: 'Save diagnostic bundle' }))
    await new Promise((r) => setTimeout(r))
    expect(screen.queryByText(/Saved/)).not.toBeInTheDocument()
  })

  it('two-click Delete forever fires IgnoreScreenshot only on confirm', async () => {
    renderWith([row()])

    await user().click(screen.getByRole('button', { name: 'Permanently ignore corrupt.png' }))
    const armed = screen.getByRole('button', { name: 'Confirm permanently ignoring corrupt.png' })
    expect(armed).toHaveTextContent(/Confirm delete\?/i)
    expect(IgnoreScreenshot).not.toHaveBeenCalled()

    await user().click(armed)
    expect(IgnoreScreenshot).toHaveBeenCalledWith('corrupt.png')
  })
})
