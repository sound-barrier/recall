// Regression test for the view-component lazy-loading split.
//
// App.vue's four view components (Matches, Ingest, Settings, Unknown)
// are loaded via defineAsyncComponent so each becomes a separate Vite
// chunk. A naïve refactor that converts one back to a static `import
// X from '…'` would silently undo the bundle-size win and inflate the
// initial JS payload that every page-load pays for.
//
// Asserts the source still uses the async-import pattern for all four
// views. Pure text inspection — doesn't try to drive the runtime, which
// is fragile across happy-dom versions.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('App.vue view-component lazy loading', () => {
  const source = readFileSync(resolve(__dirname, 'App.vue'), 'utf-8')

  const views: Array<{ name: string; path: string }> = [
    { name: 'IngestView',      path: './components/IngestView.vue' },
    { name: 'MatchesView',     path: './components/MatchesView.vue' },
    { name: 'SettingsView',    path: './components/SettingsView.vue' },
    { name: 'UnknownMapsView', path: './components/UnknownMapsView.vue' },
  ]

  for (const { name, path } of views) {
    it(`${name} is async-imported via defineAsyncComponent`, () => {
      // The exact line we expect, modulo whitespace. Quoting the dynamic
      // import path means the bundler can statically extract it for
      // chunk splitting — `defineAsyncComponent(() => import(varPath))`
      // with a runtime variable would defeat the optimisation.
      const pattern = new RegExp(
        `const\\s+${name}\\s*=\\s*defineAsyncComponent\\(\\s*\\(\\)\\s*=>\\s*import\\(['"]${escapeRegex(path)}['"]\\)\\s*\\)`,
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
