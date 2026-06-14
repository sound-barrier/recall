// Regression test for the lazy-loading split inside MatchesView.
//
// NarrowPopover is the heavyweight authoring surface for the
// "Narrow this set" panel (search, combobox pickers, date range,
// active-clause range). It only mounts when the user clicks the
// dossier trigger, so MatchesView.vue lazy-imports it via
// defineAsyncComponent — that way its ~14K of JS and ~12K of CSS
// land in their own Vite chunk and don't bloat MatchesView's
// initial parse cost on every visit to the Matches tab.
//
// A naïve refactor that flips this back to `import NarrowPopover
// from '@/components/NarrowPopover.vue'` would silently undo the split. This
// test guards the import shape via text inspection (same pattern as
// App.lazy-views.test.ts).

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('MatchesView.vue lazy-loaded children', () => {
  const source = readFileSync(resolve(__dirname, 'MatchesView.vue'), 'utf-8')

  const lazyChildren: Array<{ name: string; path: string }> = [
    { name: 'NarrowPopover', path: '@/components/NarrowPopover.vue' },
  ]

  for (const { name, path } of lazyChildren) {
    it(`${name} is async-imported via defineAsyncComponent`, () => {
      const pattern = new RegExp(
        `const\\s+${name}\\s*=\\s*defineAsyncComponent\\(\\s*\\(\\)\\s*=>\\s*import\\(['"]${escapeRegex(path)}['"]\\)\\s*\\)`,
      )
      expect(source).toMatch(pattern)
    })

    it(`${name} is NOT statically imported`, () => {
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
