// Single owner of "open a screenshot" UI state — replaces the
// parallel state machines that previously lived inline in App.vue
// (per-filename inline preview + fullscreen lightbox) and the
// preload registry inside UnknownMapsView. Consumers now ask the
// composable for the gesture they need; cache-warming is shared.
//
// Three gestures sit on shared state today:
//
//   - inline expand — `togglePreview(filename)` flips per-filename
//     state that drives the in-card `<img class="source-preview">`.
//     MatchDetailPanel + UnknownMapsView both consume this through
//     the CardStateApi bundle.
//
//   - fullscreen lightbox — `openLightbox(filename, files, dirIDs)`
//     snapshots the surrounding source list so the lightbox can
//     ←/→ paginate without the underlying record refreshing it
//     out from under the user. Closes via × / Esc / backdrop click.
//
//   - preload — `preload(url)` records that the browser cache has
//     a request in flight for a given URL. Idempotent — subsequent
//     calls with the same URL no-op so re-renders don't double-
//     fetch. Used by UnknownMapsView's hover-thumb cache warm and
//     potentially by any consumer that wants the bytes ready
//     before the user gestures.
//
// The hover-thumb gesture stays local to UnknownMapsView for now —
// it's a cursor-tracking concern tightly coupled to that view's
// mouse handlers. Future consolidation: expose a `peek(filename)`
// verb on this composable too.

import { computed, ref, type ComputedRef, type Ref } from 'vue'

export interface UseScreenshotPreview {
  // ── inline expand ────────────────────────────────────────────
  isPreviewOpen:   (filename: string) => boolean
  hasPreviewError: (filename: string) => boolean
  togglePreview:   (filename: string) => void
  onPreviewError:  (filename: string) => void

  // ── lightbox ─────────────────────────────────────────────────
  lightboxFilename: Ref<string | null>
  lightboxFiles:    Ref<string[]>
  lightboxDirIDs:   Ref<Record<string, number>>
  lightboxIndex:    ComputedRef<number>
  openLightbox:     (filename: string, files?: readonly string[], dirIDs?: Record<string, number>) => void
  closeLightbox:    () => void
  lightboxPrev:     () => void
  lightboxNext:     () => void

  // ── preload registry ─────────────────────────────────────────
  preload: (url: string) => void
}

export function useScreenshotPreview(): UseScreenshotPreview {
  // Ref typings split between the explicit-generic and the call site;
  // pass the generic arg so TS doesn't widen `null` to
  // `string | null | undefined`.
  const previewOpen  = ref<Record<string, boolean>>({})
  const previewError = ref<Record<string, boolean>>({})

  function togglePreview(filename: string) {
    previewError.value = { ...previewError.value, [filename]: false }
    previewOpen.value  = { ...previewOpen.value,  [filename]: !previewOpen.value[filename] }
  }
  function onPreviewError(filename: string) {
    previewError.value = { ...previewError.value, [filename]: true }
  }

  const lightboxFilename = ref<string | null>(null)
  const lightboxFiles    = ref<string[]>([])
  const lightboxDirIDs   = ref<Record<string, number>>({})
  const lightboxIndex = computed(() =>
    lightboxFilename.value
      ? lightboxFiles.value.indexOf(lightboxFilename.value)
      : -1,
  )
  function openLightbox(
    filename: string,
    files: readonly string[] = [filename],
    dirIDs: Record<string, number> = {},
  ) {
    lightboxFilename.value = filename
    lightboxFiles.value = files.length > 0 ? [...files] : [filename]
    lightboxDirIDs.value = { ...dirIDs }
  }
  function closeLightbox() {
    lightboxFilename.value = null
    lightboxFiles.value = []
  }
  function lightboxPrev() {
    const i = lightboxIndex.value
    if (i > 0) lightboxFilename.value = lightboxFiles.value[i - 1]!
  }
  function lightboxNext() {
    const i = lightboxIndex.value
    if (i >= 0 && i < lightboxFiles.value.length - 1) {
      lightboxFilename.value = lightboxFiles.value[i + 1]!
    }
  }

  // Browsers cache GETs by URL; once an Image() request resolves
  // the bytes live in the HTTP cache and any subsequent <img src>
  // for the same URL reads from there. The Set tracks issued URLs
  // so re-renders don't enqueue duplicate requests.
  const issued = new Set<string>()
  function preload(url: string) {
    if (!url || typeof window === 'undefined') return
    if (issued.has(url)) return
    issued.add(url)
    const probe = new Image()
    probe.src = url
  }

  return {
    isPreviewOpen:   (f: string) => !!previewOpen.value[f],
    hasPreviewError: (f: string) => !!previewError.value[f],
    togglePreview,
    onPreviewError,
    lightboxFilename,
    lightboxFiles,
    lightboxDirIDs,
    lightboxIndex,
    openLightbox,
    closeLightbox,
    lightboxPrev,
    lightboxNext,
    preload,
  }
}
