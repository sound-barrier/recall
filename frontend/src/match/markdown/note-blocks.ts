/**
 * The note grammar's PARSER — the half that reads.
 *
 * Carved out of render-markdown.ts, which keeps the half that writes HTML.
 * The split exists because the emitter is deliberately lossy and the parser is
 * not: `topHeadingLevel` normalizes a note's shallowest heading to `<h3>`, so
 * `# x` and `## x` render identically, and nothing downstream of the HTML can
 * tell which the author wrote. The editor needs to know. `Block` has carried
 * the true level all along.
 *
 * This adds NO new grammar. Every lexical decision — what a space is, what
 * opens a marker, what closes one, what starts a heading — is made here, once,
 * and both the HTML emitter and the editor's document builder consume the
 * result. The "two implementations of one grammar, pinned by one fixture"
 * guarantee that makes this grammar trustworthy is not spent.
 *
 * The Go mirror (pkg/coach/markdown.go) is unaffected: it renders the ledger
 * and has no editor to feed, so it stays one file.
 */

// The space set, written out rather than spelled `\s`. JavaScript's `\s` is
// Unicode-aware and Go's is ASCII-only, so a non-breaking space pasted out of
// a word processor would open a heading on one renderer and stay literal on
// the other. Two implementations of one grammar cannot disagree about what a
// space is.
export const SPACE = ' \t\r\n'

function isSpace(ch: string | undefined): boolean {
  return ch !== undefined && SPACE.includes(ch)
}

export interface Marker {
  open: string
  tags: readonly string[]
}

// Longest run first: `***bold italic***` must not match as `**` plus a stray
// `*`, which is exactly what the toolbar produces when you bold an italic run.
const MARKERS: readonly Marker[] = [
  { open: '***', tags: ['strong', 'em'] },
  { open: '**', tags: ['strong'] },
  { open: '~~', tags: ['del'] },
  { open: '*', tags: ['em'] },
]

/** Index of the marker that closes one opened at `from`, or -1. */
function closeOf(text: string, from: number, marker: string): number {
  for (let k = from + 1; k + marker.length <= text.length; k++) {
    if (!text.startsWith(marker, k)) continue
    // A marker must hug its content: the close cannot follow a space, which
    // is what keeps `ult_economy` and a lone `-5` literal.
    if (isSpace(text[k - 1])) continue
    return k
  }
  return -1
}

export function openAt(text: string, i: number): { marker: Marker; close: number } | null {
  for (const marker of MARKERS) {
    if (!text.startsWith(marker.open, i)) continue
    const bodyStart = i + marker.open.length
    if (isSpace(text[bodyStart])) continue
    const close = closeOf(text, bodyStart, marker.open)
    // `close > bodyStart`, not `close > 0`: a marker needs a non-empty body.
    // Without it `**not closed` matches the `*` marker against its own second
    // asterisk and emits an empty `<em></em>` before the text.
    if (close > bodyStart) return { marker, close }
  }
  return null
}

const HEADING = /^(#{1,2})[ \t]+(.*)$/
const BULLET = /^[-*][ \t]+(.*)$/
const NUMBERED = /^(\d{1,9})[.)][ \t]+(.*)$/
// Trimmed explicitly for the same reason `SPACE` is spelled out: JS `trim()`
// strips a byte-order mark and Go's `TrimSpace` does not, and Go trims U+0085
// where JS does not.
const EDGE_SPACE = /^[ \t\r]+|[ \t\r]+$/g

export type Block =
  | { kind: 'p'; lines: string[] }
  | { kind: 'h'; level: 1 | 2; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[]; start: number }

/**
 * Group the source into blocks. A blank line always closes whatever is open;
 * a heading is its own block; consecutive bullets or numbers gather into one
 * list; everything else accumulates into a paragraph whose single newlines
 * become soft breaks.
 */
export function blocksOf(source: string): Block[] {
  const blocks: Block[] = []
  // `open` is folded through the loop rather than closed over by a `close()`
  // helper: a nested function that assigns it defeats the checker's flow
  // analysis, which then reads every later `open.kind` as `never`.
  let open: Block | undefined
  for (const rawLine of source.split(/\r?\n/)) {
    open = fold(blocks, open, rawLine.replace(EDGE_SPACE, ''))
  }
  if (open) blocks.push(open)
  return blocks
}

/**
 * Take one line into the block list, returning whatever is left open. A blank
 * line closes what is open; a heading is its own block; a line of the same
 * kind joins what is open; anything else closes it and starts a new one.
 */
function fold(blocks: Block[], open: Block | undefined, line: string): Block | undefined {
  if (line === '') {
    if (open) blocks.push(open)
    return undefined
  }
  const next = classify(line)
  if (open && open.kind === next.kind && next.kind !== 'h') {
    absorb(open, line)
    return open
  }
  if (open) blocks.push(open)
  if (next.kind === 'h') {
    blocks.push(next)
    return undefined
  }
  return next
}

/** What a line starts, as a fresh block carrying that line's content. */
function classify(line: string): Block {
  const heading = HEADING.exec(line)
  if (heading) return { kind: 'h', level: heading[1]!.length as 1 | 2, text: heading[2]! }

  const bullet = BULLET.exec(line)
  if (bullet) return { kind: 'ul', items: [bullet[1]!] }

  const numbered = NUMBERED.exec(line)
  if (numbered) return { kind: 'ol', items: [numbered[2]!], start: Number(numbered[1]) }

  return { kind: 'p', lines: [line] }
}

/** Add a line to the block it continues. */
function absorb(open: Block, line: string): void {
  switch (open.kind) {
    case 'p':
      open.lines.push(line)
      return
    case 'ul':
      open.items.push(BULLET.exec(line)![1]!)
      return
    case 'ol':
      open.items.push(NUMBERED.exec(line)![2]!)
      return
    case 'h':
      return
  }
}

/**
 * The note's shallowest heading, which becomes its h3.
 *
 * Notes render INSIDE a card that already owns the page's h2, so the top
 * heading is an h3 — and a note that only ever uses `##` must still start at
 * h3 rather than skipping a level, which is precisely what axe's
 * heading-order rule reports. The toolbar offers Subheading on its own, so
 * that note is one click away.
 *
 * Lives here rather than with the HTML emitter because BOTH emitters need the
 * answer: the editor paints the same h3/h4 the ledger does, or axe fires
 * inside the contenteditable for the same reason it would anywhere else. The
 * function is not the lossy part — mapping its answer onto a tag is, and each
 * emitter does that for itself. `Block.level` is never touched.
 */
export function topHeadingLevel(blocks: readonly Block[]): number {
  let top = 2
  for (const block of blocks) {
    if (block.kind === 'h' && block.level < top) top = block.level
  }
  return top
}

/** The three marks a span can carry, as a set rather than a nesting. */
export type SpanMark = 'strong' | 'em' | 'del'

export interface Span {
  text: string
  marks: readonly SpanMark[]
}

/**
 * One line of inline text as flat spans carrying mark SETS.
 *
 * The sibling of `inline()` in render-markdown.ts, sharing this file's lexer —
 * same scan, two shapes. It is a separate function rather than a refactor of
 * that one because the two shapes are not interchangeable: HTML nests, and the
 * nesting is observable (`~~*a*~~` emits `<del><em>` and the fixture pins it),
 * while a document model holds marks unordered. Re-deriving the HTML from a
 * flat set would have to invent a canonical order and would change bytes the
 * fixture guards.
 *
 * Operates on RAW text, not escaped text — a document model escapes at render
 * time, from the text node, so escaping here would store the entities.
 */
export function inlineSpans(raw: string): Span[] {
  return spansOf(raw, [])
}

function spansOf(raw: string, marks: readonly SpanMark[]): Span[] {
  const out: Span[] = []
  let plain = ''
  let i = 0
  const flush = (): void => {
    if (plain !== '') out.push({ text: plain, marks })
    plain = ''
  }
  while (i < raw.length) {
    const found = openAt(raw, i)
    if (!found) {
      plain += raw[i]
      i += 1
      continue
    }
    flush()
    const { marker, close } = found
    const body = raw.slice(i + marker.open.length, close)
    out.push(...spansOf(body, [...marks, ...(marker.tags as readonly SpanMark[])]))
    i = close + marker.open.length
  }
  flush()
  return out
}

/**
 * A note as the plain words in it, markers dropped.
 *
 * For the one surface that can show neither markup nor markdown: the reel
 * frame's one-line quote lives inside a `<button>`, where `<p>` and `<ul>` are
 * an invalid content model. It currently prints raw `**hold**` at the reader.
 */
export function notePlainText(source: string): string {
  return blocksOf(source)
    .map(plainBlock)
    .filter((s) => s !== '')
    .join(' ')
}

function plainBlock(block: Block): string {
  const plain = (line: string): string => inlineSpans(line).map((s) => s.text).join('')
  switch (block.kind) {
    case 'p':
      return block.lines.map(plain).join(' ')
    case 'h':
      return plain(block.text)
    case 'ul':
    case 'ol':
      return block.items.map(plain).join(' ')
  }
}
