import { defineAsyncComponent, type Component } from 'vue'

import ViewLazyFallback from '@/components/app/ViewLazyFallback.vue'
import ViewLoadError from '@/components/app/ViewLoadError.vue'

// Every view-sized chunk goes through this: a skeleton after 220 ms so a
// slow chunk shows SOMETHING (the common case on throttled networks; on
// LAN / local the chunk lands first and the fallback never renders), and a
// reload affordance if the chunk fails outright — a network drop, or a
// redeploy that invalidated the old hashed filenames — instead of a
// permanent blank. App.vue's tabs and the film room inside the Reviews tab
// share it, so the room's failure surface is the tabs' failure surface.
const VIEW_LAZY_DELAY = 220

export function lazyView(loader: () => Promise<{ default: Component }>) {
  return defineAsyncComponent({
    loader,
    loadingComponent: ViewLazyFallback,
    errorComponent: ViewLoadError,
    delay: VIEW_LAZY_DELAY,
  })
}
