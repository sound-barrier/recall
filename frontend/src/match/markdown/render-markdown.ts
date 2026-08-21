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

import { openAt, blocksOf, type Block } from '@/match/markdown/note-blocks'

// The PARSER lives in note-blocks.ts; this file is the HTML emitter over what
// it returns. The split is not cosmetic: `topHeadingLevel` below is lossy on
// purpose, so the editor cannot load from this file's output and still know
// whether the author wrote `#` or `##`. It loads from the blocks instead.

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

/**
 * Inline emphasis over already-escaped text.
 *
 * A recursive scan rather than one global replace per marker: sequential
 * passes emit crossed tags for interleaved markers (`**a *b** c*` came out
 * `<strong>a <em>b</strong> c</em>`), and a browser then re-shapes that into
 * a DOM neither renderer described. Scanning left to right and recursing into
 * each body can only ever produce well-nested output.
 *
 * The nesting is OBSERVABLE and the fixture pins it — `~~*a*~~` is
 * `<del><em>`, not `<em><del>` — which is why this stayed a separate function
 * from note-blocks.ts's `inlineSpans`, whose mark sets are unordered. Same
 * lexer, two shapes; deriving one from the other would change bytes.
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

/**
 * The note's shallowest heading, which becomes its h3.
 *
 * Notes render INSIDE a card that already owns the page's h2, so the top
 * heading is an h3 — and a note that only ever uses `##` must still start at
 * h3 rather than skipping a level, which is precisely what axe's
 * heading-order rule reports. The toolbar offers Subheading on its own, so
 * that note is one click away.
 *
 * This is the lossy step, and the reason the parser is a separate module: `#`
 * alone and `##` alone both land here as h3, so HTML cannot be round-tripped
 * back to source. Block.level survives it untouched.
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
