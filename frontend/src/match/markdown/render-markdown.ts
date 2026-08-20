// The note grammar, rendered to HTML.
//
// A note is prose a player or a coach typed, so the grammar is exactly what
// the note toolbar can write and nothing else: paragraphs, two heading
// levels, bulleted and numbered lists, bold, italic, strikethrough. No
// links, no images, no tables, no raw HTML — a dependency would bring all
// of that plus a sanitizer to take it back out again.
//
// This is one of TWO implementations (the other is pkg/coach/markdown.go,
// for the exported ledger.html). They are pinned to identical output by one
// shared table, pkg/coach/testdata/markdown_cases.json, which both test
// suites read. Add a case there first, then make both sides pass it.
//
// Everything is escaped BEFORE any markup is produced, so a `<script>` in a
// note is text on every surface. The output is a fixed vocabulary of tags
// with no attributes except an `<ol start>` — there is nothing for a
// sanitizer to do afterwards.

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&#34;',
  "'": '&#39;',
}

function escapeHTML(raw: string): string {
  return raw.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch)
}

// The space set, written out rather than spelled `\s`. JavaScript's `\s` is
// Unicode-aware and Go's is ASCII-only, so a non-breaking space pasted out of
// a word processor would open a heading on one renderer and stay literal on
// the other. Two implementations of one grammar cannot disagree about what a
// space is.
const SPACE = ' \t\r\n'

function isSpace(ch: string | undefined): boolean {
  return ch !== undefined && SPACE.includes(ch)
}

interface Marker {
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

function openAt(text: string, i: number): { marker: Marker; close: number } | null {
  for (const marker of MARKERS) {
    if (!text.startsWith(marker.open, i)) continue
    const bodyStart = i + marker.open.length
    if (isSpace(text[bodyStart])) continue
    const close = closeOf(text, bodyStart, marker.open)
    if (close > bodyStart) return { marker, close }
  }
  return null
}

/**
 * Inline emphasis over already-escaped text.
 *
 * A recursive scan rather than one global replace per marker: sequential
 * passes emit crossed tags for interleaved markers (`**a *b** c*` came out
 * `<strong>a <em>b</strong> c</em>`), and a browser then re-shapes that into
 * a DOM neither renderer described. Scanning left to right and recursing into
 * each body can only ever produce well-nested output.
 */
function inline(escaped: string): string {
  let out = ''
  let i = 0
  while (i < escaped.length) {
    const found = openAt(escaped, i)
    if (!found) {
      out += escaped[i]
      i += 1
      continue
    }
    const { marker, close } = found
    const body = inline(escaped.slice(i + marker.open.length, close))
    const opened = marker.tags.map((t) => `<${t}>`).join('')
    const closed = [...marker.tags].reverse().map((t) => `</${t}>`).join('')
    out += opened + body + closed
    i = close + marker.open.length
  }
  return out
}

const HEADING = /^(#{1,2})[ \t]+(.*)$/
const BULLET = /^[-*][ \t]+(.*)$/
const NUMBERED = /^(\d{1,9})[.)][ \t]+(.*)$/
// Trimmed explicitly for the same reason `SPACE` is spelled out: JS `trim()`
// strips a byte-order mark and Go's `TrimSpace` does not, and Go trims U+0085
// where JS does not.
const EDGE_SPACE = /^[ \t\r]+|[ \t\r]+$/g

type Block =
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
function blocksOf(source: string): Block[] {
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
 */
function topHeadingLevel(blocks: Block[]): number {
  let top = 2
  for (const block of blocks) {
    if (block.kind === 'h' && block.level < top) top = block.level
  }
  return top
}

function renderBlock(block: Block, topLevel: number): string {
  const item = (text: string): string => `<li>${inline(escapeHTML(text))}</li>`
  switch (block.kind) {
    case 'p':
      return `<p>${block.lines.map((l) => inline(escapeHTML(l))).join('<br>')}</p>`
    case 'h': {
      const tag = `h${3 + block.level - topLevel}`
      return `<${tag}>${inline(escapeHTML(block.text))}</${tag}>`
    }
    case 'ul':
      return `<ul>${block.items.map(item).join('')}</ul>`
    case 'ol': {
      const start = block.start === 1 ? '' : ` start="${block.start}"`
      return `<ol${start}>${block.items.map(item).join('')}</ol>`
    }
  }
}

/** Render a note's markdown to the fixed HTML vocabulary. Safe to v-html. */
export function renderMarkdown(source: string): string {
  const blocks = blocksOf(source)
  const topLevel = topHeadingLevel(blocks)
  return blocks.map((b) => renderBlock(b, topLevel)).join('')
}
