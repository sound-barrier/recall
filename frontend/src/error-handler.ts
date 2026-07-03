import type { App } from 'vue'

import { useAppStore } from '@/stores/app'

// Last-resort error boundary (the audit's "no Vue error boundary"
// reliability gap): app.config.errorHandler catches uncaught errors
// from component renders, lifecycle hooks, and event handlers that
// would otherwise vanish into the console while the user stares at a
// partially-broken UI. The error routes to the app store's banner
// (role=alert, floats above modals) in plain language; the
// console.error keeps the developer-facing stack.
export function installGlobalErrorHandler(app: App): void {
  app.config.errorHandler = (err, _instance, info) => {
    console.error('[recall] unhandled component error:', err, info)
    try {
      const message = err instanceof Error ? err.message : String(err)
      useAppStore().setErrorFromRaw(`Something went wrong in the UI (${info}): ${message}`)
    } catch (_) {
      // Pinia not installed yet (boot-time error) — the console line
      // above is the only surface, which matches pre-handler behavior.
    }
  }
}
