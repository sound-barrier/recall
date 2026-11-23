import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/vue'
import { createPinia, setActivePinia } from 'pinia'

import type { FieldRegion } from '@/api'
import SourceCrop from '@/components/shared/SourceCrop.vue'
import { resetWriteGate, setWritesLocked } from '@/test-utils/writeGateStub'

vi.mock('@/composables/shared/useWriteGate', async () => import('@/test-utils/writeGateStub'))

// A crop is the screenshot itself, clipped to the rectangle the parse read.
// The branches that matter are the ones where there is nothing honest to
// draw: the file is gone, the rectangle names no pixels, or a coaching
// session means the screenshots are not this machine's to load.

const region = (over: Partial<FieldRegion> = {}): FieldRegion => ({
  source_file: 'summary 1.png', dir_id: 3, field: 'data.eliminations',
  x: 400, y: 300, width: 80, height: 40, image_width: 1920, image_height: 1080,
  ...over,
})

function mount(r: FieldRegion = region()) {
  const pinia = createPinia()
  setActivePinia(pinia)
  return render(SourceCrop, { props: { region: r, label: 'Eliminations' }, global: { plugins: [pinia] } })
}

const crop = () => screen.queryByRole('img', { name: 'Source crop of Eliminations from summary 1.png' })

beforeEach(() => { resetWriteGate() })

describe('SourceCrop', () => {
  it('draws the screenshot the match serves, named for the field it shows', () => {
    mount()

    expect(crop()).toBeInTheDocument()
    // eslint-disable-next-line testing-library/no-node-access -- the clipped <img> is decoration inside the named role="img" box; its src is the contract
    expect(crop()?.querySelector('img')).toHaveAttribute('src', '/_screenshot/3/summary%201.png')
  })

  it('says the source is missing when the screenshot will not load', async () => {
    mount()
    // eslint-disable-next-line testing-library/no-node-access -- the load failure fires on the decorative <img> inside the box
    const img = crop()?.querySelector('img')
    if (!img) throw new Error('no image drawn')

    await fireEvent.error(img)

    expect(crop()).not.toBeInTheDocument()
    expect(screen.getByText(/Source missing/)).toHaveTextContent("Source missing: summary 1.png isn't in the screenshots folder.")
  })

  // The file may well be on disk; what is wrong is the rectangle, and the
  // fix is a re-parse, not the screenshots folder.
  it('says no usable crop was recorded when the rectangle names no pixels', () => {
    mount(region({ width: 0 }))

    expect(crop()).not.toBeInTheDocument()
    expect(screen.queryByText(/Source missing/)).not.toBeInTheDocument()
    expect(screen.getByText('No usable crop recorded for this reading — Re-parse All to record it again.')).toBeInTheDocument()
  })

  it('loads nothing in a coaching session', () => {
    setWritesLocked(true, { session: true })
    mount()

    expect(crop()).not.toBeInTheDocument()
    // eslint-disable-next-line testing-library/no-node-access -- the decorative <img> has no role to query; no element may request the file
    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByText("Screenshots aren't included in a coaching session.")).toBeInTheDocument()
  })
})
