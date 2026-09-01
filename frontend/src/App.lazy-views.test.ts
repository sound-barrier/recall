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
import { readFileSync, readdirSync } from 'node:fs'
import { relative, resolve } from 'node:path'

describe('App.vue lazy-loaded components', () => {
  // The views stay in App.vue; the overlay/modal chunks live in
  // AppOverlays.vue and the coaching-session chrome in AppMasthead.vue.
  // Concatenate all three so the lazy-pattern assertions match wherever the
  // component now lives — the bundle-size win is identical.
  const source =
    readFileSync(resolve(__dirname, 'App.vue'), 'utf-8') +
    readFileSync(resolve(__dirname, 'components/app/AppOverlays.vue'), 'utf-8') +
    readFileSync(resolve(__dirname, 'components/app/AppMasthead.vue'), 'utf-8') +
    // The film room is hosted by the Reviews view now, and stays its own
    // chunk inside that one — the tab is visited by people who will never
    // open a bundle.
    // The note editor is lazy INSIDE NoteWriter, which is itself reached from
    // two already-lazy parents. It is the largest single chunk in the app.
    readFileSync(resolve(__dirname, 'components/shared/NoteWriter.vue'), 'utf-8') +
    readFileSync(resolve(__dirname, 'components/reviews/ReviewsView.vue'), 'utf-8')

  const views: Array<{ name: string; path: string }> = [
    { name: 'IngestView',             path: '@/components/ingest/IngestView.vue' },
    { name: 'MatchesView',            path: '@/components/matches/MatchesView.vue' },
    { name: 'SettingsView',           path: '@/components/settings/SettingsView.vue' },
    { name: 'UnknownMapsView',        path: '@/components/unknown/UnknownMapsView.vue' },
    { name: 'SeasonCompareView',      path: '@/components/compare/SeasonCompareView.vue' },
    { name: 'EloCalculatorView',      path: '@/components/elo/EloCalculatorView.vue' },
    // Off by default, so most launches never fetch this chunk at all.
    { name: 'SessionBanner',          path: '@/components/matches/session/SessionBanner.vue' },
    { name: 'ReviewsView',            path: '@/components/reviews/ReviewsView.vue' },
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
    // "Export backup…" on the Matches bulk-action bar.
    { name: 'ExportBundleModal',      path: '@/components/matches/export/ExportBundleModal.vue' },
    // Send to a coach — the outbound leg of the review cycle. Lazy for the
    // same reason: nobody who never sends a bundle should carry its bytes.
    { name: 'SendToCoachModal',      path: '@/components/reviews/SendToCoachModal.vue' },
    // Anchor confirmation toast — small, but lazy so the bytes only
    // hit users who actually stamp an anchor.
    { name: 'MatchAnchorToast',       path: '@/components/matches/toasts/MatchAnchorToast.vue' },
    // End-of-run outcome toast — only raised by a parse-complete that
    // carries a summary, so its bytes ride with the other overlay chunks.
    { name: 'ParseOutcomeToast',      path: '@/components/ingest/ParseOutcomeToast.vue' },
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
    // who never opens a bundle should carry a byte of them; the room is
    // lazy inside the (itself lazy) Reviews view.
    { name: 'CoachRoomView',          path: '@/components/coach/room/CoachRoomView.vue' },
    { name: 'CoachLoanSlip',          path: '@/components/coach/room/CoachLoanSlip.vue' },
    { name: 'CoachNavStrip',          path: '@/components/coach/room/CoachNavStrip.vue' },
    // The note editor — ~345 KB raw, ~102 KB gzipped, the largest chunk in
    // the app by a distance. Everything else here is lazy to keep the first
    // paint small; this one is lazy because most sessions never write a note
    // at all, and the ones that do can afford to fetch it when they start.
    { name: 'NoteRichText',           path: '@/components/shared/NoteRichText.vue' },
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

// The async boundary above is only worth as much as the module graph behind
// it. NoteWriter reached into note-tiptap.ts for a length constant once, and
// that one static import pulled every @tiptap package into NoteWriter's own
// chunk — the defineAsyncComponent still there, still doing nothing. Measured
// at the time: total JS went from 1.77 MB to 2.12 MB with the editor sitting
// in a chunk that was no longer lazy.
describe('the editor stays behind its dynamic import', () => {
  const SRC = resolve(__dirname)

  function tiptapImporters(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name)
      if (entry.isDirectory()) {
        tiptapImporters(full, found)
        continue
      }
      if (!/\.(ts|vue)$/.test(entry.name) || entry.name.endsWith('.test.ts')) continue
      const text = readFileSync(full, 'utf-8')
      if (/^import[^\n]*from\s*['"]@tiptap\//m.test(text)) found.push(relative(SRC, full))
    }
    return found
  }

  it('is imported statically by note-tiptap.ts and NoteRichText.vue, and nothing else', () => {
    expect(tiptapImporters(SRC).sort()).toEqual([
      'components/shared/NoteRichText.vue',
      'components/shared/note-tiptap.ts',
    ])
  })

  it('is not reachable statically from NoteWriter', () => {
    const writer = readFileSync(resolve(SRC, 'components/shared/NoteWriter.vue'), 'utf-8')
    expect(writer).not.toMatch(/^import[^\n]*from\s*['"]@\/components\/shared\/note-tiptap['"]/m)
  })
})

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
