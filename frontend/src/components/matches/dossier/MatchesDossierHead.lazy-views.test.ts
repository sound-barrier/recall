// Regression test for the lazy-loading split inside MatchesDossierHead.
//
// MatchesDossierHead owns the popover-mode "Filter matches" trigger,
// which mounts NarrowPopover — the heavyweight authoring surface (search,
// combobox pickers, date range, active-clause range). It only mounts when
// the user opens the popover, so the head lazy-imports it via
// defineAsyncComponent so its ~14K of JS / ~12K of CSS land in their own
// Vite chunk instead of the dossier head's initial parse cost.
//
// A naïve refactor that flips this back to a static
// `import NarrowPopover from '@/components/matches/narrow/NarrowPopover.vue'` would silently undo
// the split. This guards the import shape via text inspection (same
// pattern as MatchesView.lazy-views.test.ts).

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('MatchesDossierHead.vue lazy-loaded children', () => {
  const source = readFileSync(resolve(__dirname, 'MatchesDossierHead.vue'), 'utf-8')

  const lazyChildren: Array<{ name: string; path: string }> = [
    { name: 'NarrowPopover', path: '@/components/matches/narrow/NarrowPopover.vue' },
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
