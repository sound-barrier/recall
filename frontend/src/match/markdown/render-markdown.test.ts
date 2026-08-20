import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { renderMarkdown } from '@/match/markdown/render-markdown'

// The SHARED table, read straight from where the Go renderer reads it. Two
// implementations of one grammar only stay honest if a single fixture pins
// them — so this suite and pkg/coach's TestRenderMarkdown execute the same
// pairs, and a case added to the file fails whichever side has not caught up.
const FIXTURE = resolve(__dirname, '../../../../pkg/coach/testdata/markdown_cases.json')
const cases = (JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
  cases: { name: string; in: string; out: string }[]
}).cases

describe('renderMarkdown — the shared note grammar', () => {
  it('has cases to run', () => {
    expect(cases.length).toBeGreaterThan(20)
  })

  it.each(cases.map((c) => [c.name, c.in, c.out] as const))(
    '%s', (_name, input, expected) => {
      expect(renderMarkdown(input)).toBe(expected)
    },
  )
})
