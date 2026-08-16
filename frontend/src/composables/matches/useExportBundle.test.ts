import { beforeEach, describe, expect, it, vi } from 'vitest'

import { setApiBacking } from '@/api-client'
import { useExportBundle } from '@/composables/matches/useExportBundle'

// The two export modes the Matches bulk bar can produce. A plain bundle is
// a backup; a share bundle names its player, so a coach can open it as a
// session and a mis-clicked Import refuses to merge it. Only the request
// this composable builds tells the two apart.

let api: Record<string, ReturnType<typeof vi.fn>>
const errors: string[] = []

function bundle() {
  const flow = useExportBundle({ onError: (raw) => { errors.push(raw) } })
  flow.onExportBundleRequest(['k1', 'k2'])
  return flow
}

beforeEach(() => {
  errors.length = 0
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
      share: null,
    })

    expect(api.ExportBundle).toHaveBeenCalledWith({
      matchKeys: ['k1', 'k2'],
      includeHidden: true,
      includeUnknown: false,
    })
    expect(flow.exportBundleOpen.value).toBe(false)
    expect(flow.exportBundleSelectedKeys.value).toEqual([])
  })
})

describe('useExportBundle — sharing with a coach', () => {
  it('carries the handle and the message the player wrote', async () => {
    const flow = bundle()

    await flow.onExportBundleConfirm({
      filename: 'for-ordo.zip',
      includeHidden: false,
      includeUnknown: false,
      share: { handle: 'Sable', message: 'Mostly worried about ult timing.' },
    })

    expect(api.ExportBundle).toHaveBeenCalledWith({
      matchKeys: ['k1', 'k2'],
      includeHidden: false,
      includeUnknown: false,
      share: { handle: 'Sable', message: 'Mostly worried about ult timing.' },
    })
  })

  it('reports a refused share without leaving the modal open', async () => {
    api.ExportBundle = vi.fn(async () => { throw new Error('400 handle required') })
    setApiBacking(api)
    const flow = bundle()

    await flow.onExportBundleConfirm({
      filename: '', includeHidden: false, includeUnknown: false, share: { handle: 'Sable', message: '' },
    })

    expect(errors).toHaveLength(1)
    expect(flow.exportBundleOpen.value).toBe(false)
  })
})
