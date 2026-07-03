import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createApp, defineComponent, h, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

import { installGlobalErrorHandler } from '@/error-handler'
import { useAppStore } from '@/stores/app'

// The global error boundary: an uncaught error in any component
// render/lifecycle/handler otherwise vanishes into the console — the
// user sees a partially-broken UI with no explanation. It must land
// in the app store's error banner (role=alert, floats above modals).

describe('installGlobalErrorHandler', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('routes a component lifecycle error into the error banner', async () => {
    const Boom = defineComponent({
      mounted() { throw new Error('widget exploded') },
      render() { return h('div') },
    })
    const pinia = createPinia()
    setActivePinia(pinia)
    const app = createApp(Boom).use(pinia)
    installGlobalErrorHandler(app)

    app.mount(document.createElement('div'))
    await nextTick()

    expect(useAppStore().error).not.toBe('')
    // The console keeps the developer-facing stack.
    expect(console.error).toHaveBeenCalled()
  })
})
