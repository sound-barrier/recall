import { beforeEach, describe, expect, it, vi } from 'vitest'

import { setApiBacking } from '@/api-client'
import { useExportBundle } from '@/composables/matches/useExportBundle'

// The backup bundle the Matches bulk bar produces. Sending matches to a
// coach is its own composable now (useShareWithCoach) — this one is a
// backup and nothing else.

let api: Record<string, ReturnType<typeof vi.fn>>
const errors: string[] = []
const receipts: string[] = []

function bundle() {
  const flow = useExportBundle({
    onError: (raw) => { errors.push(raw) },
    onSaved: (message) => { receipts.push(message) },
  })
  flow.onExportBundleRequest(['k1', 'k2'])
  return flow
}

beforeEach(() => {
  errors.length = 0
  receipts.length = 0
  api = {
    ExportBundle: vi.fn(async () => 'recall-bundle.zip'),
    ExportMatchesCSV: vi.fn(async () => 'matches.csv'),
  }
  setApiBacking(api)
})

describe('useExportBundle — a plain export', () => {
  it('sends the ticked selection and both toggles, and no identity', async () => {
    const flow = bundle()

    await flow.onExportBundleConfirm({
      filename: 'my-backup.zip',
      includeHidden: true,
      includeUnknown: false,
    })

    expect(api.ExportBundle).toHaveBeenCalledWith({
      matchKeys: ['k1', 'k2'],
      filename: 'my-backup.zip',
      includeHidden: true,
      includeUnknown: false,
    })
    expect(flow.exportBundleOpen.value).toBe(false)
    expect(flow.exportBundleSelectedKeys.value).toEqual([])
  })
})
