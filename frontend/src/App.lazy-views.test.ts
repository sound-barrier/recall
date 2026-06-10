// Regression test for the lazy-loading split.
//
// App.vue's four view components (Matches, Ingest, Settings, Unknown)
// AND the three modal surfaces (detail panel, screenshot lightbox,
// cheatsheet) are loaded via defineAsyncComponent so each becomes a
// separate Vite chunk. A naïve refactor that converts one back to a
// static `import X from '…'` would silently undo the bundle-size win
// and inflate the initial JS payload that every page-load pays for.
//
// Asserts the source still uses the async-import pattern for every
// entry below. Pure text inspection — doesn't try to drive the
// runtime, which is fragile across happy-dom versions.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('App.vue lazy-loaded components', () => {
  const source = readFileSync(resolve(__dirname, 'App.vue'), 'utf-8')

  const views: Array<{ name: string; path: string }> = [
    { name: 'IngestView',             path: './components/IngestView.vue' },
    { name: 'MatchesView',            path: './components/MatchesView.vue' },
    { name: 'SettingsView',           path: './components/SettingsView.vue' },
    { name: 'UnknownMapsView',        path: './components/UnknownMapsView.vue' },
    { name: 'MatchDetailPanel',       path: './components/MatchDetailPanel.vue' },
    { name: 'MatchScreenshotLightbox', path: './components/MatchScreenshotLightbox.vue' },
    { name: 'KeyboardShortcutsModal', path: './components/KeyboardShortcutsModal.vue' },
    // First-run modal — only renders on a fresh install, so the cost
    // of its bytes should only be paid by users who actually see it.
    { name: 'FirstRunProfileModal',   path: './components/FirstRunProfileModal.vue' },
    // Export bundle modal — only renders when the user clicks
    // "Export bundle…" on the Matches bulk-action bar.
    { name: 'ExportBundleModal',      path: './components/ExportBundleModal.vue' },
    // Anchor confirmation toast — small, but lazy so the bytes only
    // hit users who actually stamp an anchor.
    { name: 'MatchAnchorToast',       path: './components/MatchAnchorToast.vue' },
    // Update-check modal — only mounted when the user runs a check.
    { name: 'UpdateCheckModal',       path: './components/UpdateCheckModal.vue' },
  ]

  for (const { name, path } of views) {
    it(`${name} is async-imported via defineAsyncComponent or lazyView`, () => {
      // Two valid shapes:
      //   const X = defineAsyncComponent(() => import('./X.vue'))
      //   const X = lazyView(() => import('./X.vue'))     ← view chunks
      // `lazyView` is the App.vue helper that wraps defineAsyncComponent
      // with a loading fallback + delay. Both compile to the same
      // dynamic import that Vite statically extracts for chunk splitting
      // — a runtime variable would defeat the optimisation either way.
      const pattern = new RegExp(
        `const\\s+${name}\\s*=\\s*(?:defineAsyncComponent|lazyView)\\(\\s*(?:\\{[^}]*loader:\\s*)?\\(\\)\\s*=>\\s*import\\(['"]${escapeRegex(path)}['"]\\)`,
      )
      expect(source).toMatch(pattern)
    })

    it(`${name} is NOT statically imported`, () => {
      // Catches the regression where someone re-adds the old
      // `import X from './components/X.vue'` line during a refactor
      // and the async version becomes dead code.
      const staticImport = new RegExp(
        `^import\\s+${name}\\s+from\\s+['"]${escapeRegex(path)}['"]`,
        'm',
      )
      expect(source).not.toMatch(staticImport)
    })
  }
})

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
