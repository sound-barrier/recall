import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import type { NamedCandidate } from '../api'
import ScreenshotSourcePicker from './ScreenshotSourcePicker.vue'

function mk(over: Partial<NamedCandidate>): NamedCandidate {
  return {
    name:   'nvidia',
    label:  'Nvidia Overlay',
    path:   'C:\\Users\\Jacob\\Videos\\Overwatch',
    exists: true,
    ...over,
  }
}

const fourCards: NamedCandidate[] = [
  mk({ name: 'nvidia',  label: 'Nvidia Overlay', path: 'C:\\Users\\J\\Videos\\Overwatch',          exists: true  }),
  mk({ name: 'prntscn', label: 'OW default',     path: 'C:\\Users\\J\\Documents\\Overwatch\\SS\\Overwatch', exists: false }),
  mk({ name: 'snip',    label: 'Snip tool',      path: 'C:\\Users\\J\\Pictures\\Screenshots',      exists: true  }),
  mk({ name: 'steam',   label: 'Steam install',  path: '', exists: false }),
]

describe('ScreenshotSourcePicker', () => {
  it('renders the 2 × 2 grid + four cards on Windows', () => {
    const w = mount(ScreenshotSourcePicker, {
      props: { platform: 'windows', candidates: fourCards },
    })
    expect(w.find('[data-src-grid]').exists()).toBe(true)
    expect(w.findAll('.src-card')).toHaveLength(4)
  })

  it('emits pick(name, path) when a found card is clicked', async () => {
    const w = mount(ScreenshotSourcePicker, {
      props: { platform: 'windows', candidates: fourCards },
    })
    await w.find('[data-src-name="nvidia"]').trigger('click')
    expect(w.emitted('pick')![0]).toEqual(['nvidia', 'C:\\Users\\J\\Videos\\Overwatch'])
  })

  it('does not emit pick when a missing card is clicked', async () => {
    const w = mount(ScreenshotSourcePicker, {
      props: { platform: 'windows', candidates: fourCards },
    })
    await w.find('[data-src-name="prntscn"]').trigger('click')
    expect(w.emitted('pick')).toBeUndefined()
  })

  it('marks missing cards as aria-disabled', () => {
    const w = mount(ScreenshotSourcePicker, {
      props: { platform: 'windows', candidates: fourCards },
    })
    const missing = w.find('[data-src-name="prntscn"]')
    expect(missing.attributes('aria-disabled')).toBe('true')
    expect(missing.attributes('disabled')).toBeDefined()
  })

  it('emits pick-custom when the custom-pick tile is clicked', async () => {
    const w = mount(ScreenshotSourcePicker, {
      props: { platform: 'windows', candidates: fourCards },
    })
    await w.find('[data-src-pick-custom]').trigger('click')
    expect(w.emitted('pick-custom')).toBeTruthy()
  })

  it('hides the grid on macOS and shows the platform note', () => {
    const w = mount(ScreenshotSourcePicker, {
      props: { platform: 'darwin', candidates: [] },
    })
    expect(w.find('[data-src-grid]').exists()).toBe(false)
    expect(w.find('[data-src-platform-note]').text()).toContain('WINDOWS ONLY')
    // Pick-custom tile is still rendered so the Mac user can pick
    // their folder manually.
    expect(w.find('[data-src-pick-custom]').exists()).toBe(true)
  })

  it('hides the grid on Linux and shows the platform note', () => {
    const w = mount(ScreenshotSourcePicker, {
      props: { platform: 'linux', candidates: [] },
    })
    expect(w.find('[data-src-grid]').exists()).toBe(false)
    expect(w.find('[data-src-platform-note]').exists()).toBe(true)
  })

  it('disables every interactive element while picking', () => {
    const w = mount(ScreenshotSourcePicker, {
      props: { platform: 'windows', candidates: fourCards, picking: true },
    })
    expect(w.find('[data-src-name="nvidia"]').attributes('disabled')).toBeDefined()
    expect(w.find('[data-src-pick-custom]').attributes('disabled')).toBeDefined()
  })
})
