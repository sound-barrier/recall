import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Every component that WEARS the toast family has to import the family.
//
// The seven toasts were collapsed into one stylesheet so they could stop
// being seven copies of the same chrome. That file then lived in
// styles/toasts.css, which app.css imports — and since every toast is a
// lazily-loaded overlay, that put their chrome in the INITIAL stylesheet
// for every user, including the ones who never see a toast. Moving it to a
// sibling the components import fixed the weight and introduced this bug:
// one component was missed and rendered completely unstyled, and nothing
// caught it, because a missing stylesheet breaks no test that queries by
// role or text.
//
// A structural check instead. It reads the sources rather than rendering,
// because what is being asserted is a wiring fact, not a behavior.

const SRC = join(import.meta.dirname, '..', '..')
const FAMILY = /class="[^"]*\btoast(-undo|-notice|-name|-body|-glyph|-sub|-action|-close|-dismiss)?\b/

function vueFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name)
    if (e.isDirectory()) return vueFilesUnder(full)
    return e.isFile() && e.name.endsWith('.vue') ? [full] : []
  })
}

describe('the toast family', () => {
  it('is imported by every component that wears it', () => {
    const offenders = vueFilesUnder(join(SRC, 'components')).filter((f) => {
      const body = readFileSync(f, 'utf8')
      return FAMILY.test(body) && !body.includes('toasts.css')
    })
    expect(offenders.map((f) => f.replace(SRC, 'src'))).toEqual([])
  })
})
