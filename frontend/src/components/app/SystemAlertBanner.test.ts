import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/vue'
import { createPinia, setActivePinia } from 'pinia'

import SystemAlertBanner from '@/components/app/SystemAlertBanner.vue'
import type { TesseractStatus } from '@/api-client'
import { useSettingsStore } from '@/stores/settings'

function status(over: Partial<TesseractStatus>): TesseractStatus {
  return {
    state: 'unavailable', path: '/usr/bin/tesseract', found: false, version: '', supported: false,
    error: 'Nothing exists at /usr/bin/tesseract.', default: '/usr/bin/tesseract', platform: 'linux', ...over,
  }
}

function renderBanner(s: TesseractStatus) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useSettingsStore().setTesseractStatus(s)
  return render(SystemAlertBanner, { global: { plugins: [pinia] } })
}

describe('SystemAlertBanner', () => {
  it('halts with the path and the way to fix it when the engine is unavailable', () => {
    renderBanner(status({}))
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Tesseract not detected')
    expect(alert).toHaveTextContent('/usr/bin/tesseract')
    expect(screen.getByRole('button', { name: /Settings → Engine/ })).toBeInTheDocument()
  })

  // The boot probe has not answered yet: that is not "offline", and a halt
  // that flashes up and vanishes a second later reads as a broken install.
  it('stays out of the way while the boot probe is still checking', () => {
    renderBanner(status({ state: 'probing', error: '' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('stays out of the way when the engine is ready', () => {
    renderBanner(status({ state: 'ready', found: true, version: '5.5.0', supported: true, error: '' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
