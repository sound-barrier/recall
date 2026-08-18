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
  // The views stay in App.vue; the overlay/modal chunks live in
  // AppOverlays.vue and the coaching-session chrome in AppMasthead.vue.
  // Concatenate all three so the lazy-pattern assertions match wherever the
  // component now lives — the bundle-size win is identical.
  const source =
    readFileSync(resolve(__dirname, 'App.vue'), 'utf-8') +
    readFileSync(resolve(__dirname, 'components/app/AppOverlays.vue'), 'utf-8') +
    readFileSync(resolve(__dirname, 'components/app/AppMasthead.vue'), 'utf-8')

  const views: Array<{ name: string; path: string }> = [
    { name: 'IngestView',             path: '@/components/ingest/IngestView.vue' },
    { name: 'MatchesView',            path: '@/components/matches/MatchesView.vue' },
    { name: 'SettingsView',           path: '@/components/settings/SettingsView.vue' },
    { name: 'UnknownMapsView',        path: '@/components/unknown/UnknownMapsView.vue' },
    { name: 'SeasonCompareView',      path: '@/components/compare/SeasonCompareView.vue' },
    { name: 'EloCalculatorView',      path: '@/components/elo/EloCalculatorView.vue' },
    { name: 'MatchDetailPanel',       path: '@/components/matches/detail/MatchDetailPanel.vue' },
    { name: 'MatchScreenshotLightbox', path: '@/components/matches/detail/MatchScreenshotLightbox.vue' },
    { name: 'KeyboardShortcutsModal', path: '@/components/app/KeyboardShortcutsModal.vue' },
    // Command palette — a jump-to affordance nobody has opened yet has no
    // business in the first chunk, and the initial-JS budget has only a few KB
    // of headroom.
    { name: 'CommandPalette',         path: '@/components/shared/CommandPalette.vue' },
    // First-run modal — only renders on a fresh install, so the cost
    // of its bytes should only be paid by users who actually see it.
    { name: 'FirstRunProfileModal',   path: '@/components/app/FirstRunProfileModal.vue' },
    // Export bundle modal — only renders when the user clicks
    // "Export bundle…" on the Matches bulk-action bar.
    { name: 'ExportBundleModal',      path: '@/components/matches/export/ExportBundleModal.vue' },
    // Anchor confirmation toast — small, but lazy so the bytes only
    // hit users who actually stamp an anchor.
    { name: 'MatchAnchorToast',       path: '@/components/matches/toasts/MatchAnchorToast.vue' },
    // About dialog — identity + update hub, only mounted when the user opens it.
    { name: 'AboutModal',             path: '@/components/update/AboutModal.vue' },
    // Settings dialog — the ⌘, / app-menu / kebab Preferences surface.
    { name: 'SettingsModal',          path: '@/components/settings/SettingsModal.vue' },
    // Manual-entry modal — only mounted when the user clicks "Add match".
    { name: 'ManualMatchModal',       path: '@/components/matches/manual/ManualMatchModal.vue' },
    // The return-of-notes sheet — only ever opened by a player who
    // imported a coach's archive, so its bytes stay off everyone else's
    // first paint.
    { name: 'CoachReturnSheet',       path: '@/components/coach/inbox/CoachReturnSheet.vue' },
    // The film room and its masthead chrome — a coach's surfaces. Nobody
    // who never opens a bundle should carry a byte of them.
    { name: 'CoachRoomView',          path: '@/components/coach/room/CoachRoomView.vue' },
    { name: 'CoachLoanSlip',          path: '@/components/coach/room/CoachLoanSlip.vue' },
    { name: 'CoachNavStrip',          path: '@/components/coach/room/CoachNavStrip.vue' },
  ]

  for (const { name, path } of views) {
    it(`${name} is async-imported via defineAsyncComponent or lazyView`, () => {
      // Three valid shapes:
      //   const X = defineAsyncComponent(() => import('./X.vue'))
      //   const X = lazyView(() => import('./X.vue'))     ← view chunks
      //   const X = lazyOverlay(() => import('./X.vue'))  ← modal chunks
      // `lazyView` (App.vue) adds a loading fallback + delay;
      // `lazyOverlay` (AppOverlays.vue) adds the chunk-failure error
      // component. All compile to the same dynamic import that Vite
      // statically extracts for chunk splitting — a runtime variable
      // would defeat the optimization either way.
      const pattern = new RegExp(
        `const\\s+${name}\\s*=\\s*(?:defineAsyncComponent|lazyView|lazyOverlay)\\(\\s*(?:\\{[^}]*loader:\\s*)?\\(\\)\\s*=>\\s*import\\(['"]${escapeRegex(path)}['"]\\)`,
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
