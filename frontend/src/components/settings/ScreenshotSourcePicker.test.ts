import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'

import type { NamedCandidate } from '@/api'
import ScreenshotSourcePicker from '@/components/settings/ScreenshotSourcePicker.vue'

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

const grid = () => screen.queryByLabelText('Auto-detected screenshot sources')
const customTile = () => screen.getByRole('button', { name: /Pick a different folder/ })

describe('ScreenshotSourcePicker', () => {
  it('renders the 2 × 2 grid + four cards on Windows', () => {
    render(ScreenshotSourcePicker, {
      props: { platform: 'windows', candidates: fourCards },
    })
    expect(grid()).toBeInTheDocument()
    expect(within(grid()!).getAllByRole('button')).toHaveLength(4)
  })

  it('emits pick(name, path) when a found card is clicked', async () => {
    const user = userEvent.setup()
    const { emitted } = render(ScreenshotSourcePicker, {
      props: { platform: 'windows', candidates: fourCards },
    })
    await user.click(screen.getByRole('button', { name: /Nvidia Overlay/ }))
    expect(emitted('pick')[0]).toEqual(['nvidia', 'C:\\Users\\J\\Videos\\Overwatch'])
  })

  it('does not emit pick when a missing card is clicked', async () => {
    const user = userEvent.setup()
    const { emitted } = render(ScreenshotSourcePicker, {
      props: { platform: 'windows', candidates: fourCards },
    })
    await user.click(screen.getByRole('button', { name: /OW default/ }))
    expect(emitted('pick')).toBeUndefined()
  })

  it('marks missing cards as aria-disabled', () => {
    render(ScreenshotSourcePicker, {
      props: { platform: 'windows', candidates: fourCards },
    })
    const missing = screen.getByRole('button', { name: /OW default/ })
    expect(missing).toHaveAttribute('aria-disabled', 'true')
    expect(missing).toBeDisabled()
  })

  it('emits pick-custom when the custom-pick tile is clicked', async () => {
    const user = userEvent.setup()
    const { emitted } = render(ScreenshotSourcePicker, {
      props: { platform: 'windows', candidates: fourCards },
    })
    await user.click(customTile())
    expect(emitted('pick-custom')).toBeTruthy()
  })

  it('hides the grid on macOS and shows the platform note', () => {
    render(ScreenshotSourcePicker, {
      props: { platform: 'darwin', candidates: [] },
    })
    expect(grid()).not.toBeInTheDocument()
    expect(screen.getByText(/WINDOWS ONLY/)).toBeInTheDocument()
    // Pick-custom tile is still rendered so the Mac user can pick
    // their folder manually.
    expect(customTile()).toBeInTheDocument()
  })

  it('hides the grid on Linux and shows the platform note', () => {
    render(ScreenshotSourcePicker, {
      props: { platform: 'linux', candidates: [] },
    })
    expect(grid()).not.toBeInTheDocument()
    expect(screen.getByText(/WINDOWS ONLY/)).toBeInTheDocument()
  })

  it('disables every interactive element while picking', () => {
    render(ScreenshotSourcePicker, {
      props: { platform: 'windows', candidates: fourCards, picking: true },
    })
    expect(screen.getByRole('button', { name: /Nvidia Overlay/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Opening picker/ })).toBeDisabled()
  })
})
