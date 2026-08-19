import { beforeEach, describe, expect, it, vi } from 'vitest'

import { setApiBacking } from '@/api-client'
import { useExportBundle } from '@/composables/matches/useExportBundle'

// The two export modes the Matches bulk bar can produce. A plain bundle is
// a backup; a share bundle names its player, so a coach can open it as a
// session and a mis-clicked Import refuses to merge it. Only the request
// this composable builds tells the two apart.

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
      share: null,
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

describe('useExportBundle — sharing with a coach', () => {
  // The intent rides with the request so a caller that MEANS "share" (the
  // Reviews tab, the palette) opens the dialog already in share mode; a plain
  // export request leaves it off, and it does not stick between requests.
  it('remembers whether the request meant to share, per request', () => {
    const flow = useExportBundle({ onError: () => {}, onSaved: () => {} })
    flow.onExportBundleRequest(['k1'], { share: true })
    expect(flow.exportBundleShareIntent.value).toBe(true)
    expect(flow.exportBundleSelectedKeys.value).toEqual(['k1'])

    flow.onExportBundleRequest(['k2'])
    expect(flow.exportBundleShareIntent.value).toBe(false)
  })

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
      filename: 'for-ordo.zip',
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

  // The modal collects a destination name; it used to stop there.
  it('carries the name the user typed into the export', async () => {
    const flow = bundle()
    await flow.onExportBundleConfirm({
      filename: 'my-season-review.zip', includeHidden: false, includeUnknown: false, share: null,
    })
    expect(api.ExportBundle).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'my-season-review.zip' }),
    )
  })

  // The one action whose whole purpose is producing a file for somebody else
  // used to finish in complete silence: no path, no confirmation, nothing on
  // screen to say it had happened.
  it('reports where the file went, and says which kind it was', async () => {
    const flow = bundle()
    await flow.onExportBundleConfirm({
      filename: 'x.zip', includeHidden: false, includeUnknown: false,
      share: { handle: 'Sable', message: '' },
    })
    expect(receipts).toEqual(['Shared: recall-bundle.zip'])

    receipts.length = 0
    await flow.onExportBundleConfirm({
      filename: 'x.zip', includeHidden: false, includeUnknown: false, share: null,
    })
    expect(receipts).toEqual(['Saved: recall-bundle.zip'])
  })

  // A dismissed native save dialog answers "" — nothing was written, so there
  // is nothing to report, and a receipt would be a claim about a file that
  // does not exist.
  it('says nothing when the save dialog was dismissed', async () => {
    api.ExportBundle = vi.fn(async () => '')
    setApiBacking(api)
    const flow = bundle()
    await flow.onExportBundleConfirm({
      filename: 'x.zip', includeHidden: false, includeUnknown: false, share: null,
    })
    expect(receipts).toEqual([])
  })
})
