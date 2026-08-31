// The note grammar, rendered to HTML.
//
// A note is prose a player or a coach typed, so the grammar is exactly what
// the note toolbar can write and nothing else: paragraphs, two heading
// levels, bulleted and numbered lists, bold, italic, strikethrough. No
// links, no images, no tables, no raw HTML — a dependency would bring all
// of that plus a sanitizer to take it back out again.
//
// This is the ONE implementation of the note grammar, and it was not always.
// A second lived in pkg/coach/markdown.go, rendering the ledger.html a coach
// exported, and the two were pinned to identical output by the shared table
// in ./testdata/markdown_cases.json. When the coach's page moved here — to
// where the app's real stylesheets are — that renderer lost its only caller
// and went with it, and the table came along.
//
// The table is still the spec rather than a regression net: its expected
// outputs are hand-authored, so a case is added THERE first and this file is
// then made to pass it.
//
// Everything is escaped BEFORE any markup is produced, so a `<script>` in a
// note is text on every surface. The output is a fixed vocabulary of tags
// with no attributes except an `<ol start>` — there is nothing for a
// sanitizer to do afterwards.

import {
  openAt, blocksOf, inlineSpans, topHeadingLevel, type Block, type SpanMark,
} from '@/match/markdown/note-blocks'

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

/**
 * Escape text for HTML.
 *
 * Exported because the coach's sheet builds a whole document by string
 * concatenation and every interpolation has to go through exactly one
 * escaper. Two copies of "what needs escaping" is how one of them ends up
 * missing an apostrophe.
 */
export function escapeHTML(raw: string): string {
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

/**
 * Inline-only markdown, for the short captions that are not prose.
 *
 * A moment is one line beside a clock, and a focus item is one line beside a
 * bullet. They want the same emphasis a note gets — a coach writing
 * `**do not** peek there` should not reach the player as literal asterisks —
 * but not block structure: renderMarkdown would put a `<p>` inside the span
 * the caption renders into, and would turn a caption that happens to start
 * with a dash into a list.
 *
 * Same escaper and same inline lexer as the block renderer, so the two can
 * never disagree about what `~~*a*~~` nests to. Safe to v-html for the same
 * reason renderMarkdown is: the text is escaped before any markup is emitted,
 * and the tag vocabulary is fixed and attribute-free.
 */
export function renderInlineMarkdown(source: string): string {
  return source.split('\n').map((line) => inline(escapeHTML(line))).join('<br>')
}

/** Render a note's markdown to the fixed HTML vocabulary. Safe to v-html. */
export function renderMarkdown(source: string): string {
  const blocks = blocksOf(source)
  const topLevel = topHeadingLevel(blocks)
  return blocks.map((b) => renderBlock(b, topLevel)).join('')
}

// ── search hits ─────────────────────────────────────────────────────────

const TAG_OF: Record<SpanMark, string> = { strong: 'strong', em: 'em', del: 'del' }

/**
 * A note rendered with its search hits lit.
 *
 * A frontend-only sibling of renderMarkdown, and deliberately not part of the
 * grammar the Go mirror answers to: the exported ledger has no search box, so
 * there is nothing over there for `<mark>` to mirror. renderMarkdown itself is
 * untouched and still byte-pinned to pkg/coach/markdown.go by the fixture.
 *
 * Highlighting cannot be applied to the SOURCE before rendering — the `<mark>`
 * would land inside the markdown and either break a marker or be escaped into
 * view. So it splits the spans the parser already produced, which also makes
 * the match better than it was: terms now match the words a reader sees, not
 * the characters the author typed, so searching `hold` finds it inside
 * `**hold**`.
 */
export function renderMarkdownWithHits(source: string, terms: readonly string[]): string {
  const wanted = terms.map((t) => t.toLowerCase()).filter((t) => t !== '')
  if (wanted.length === 0) return renderMarkdown(source)
  const blocks = blocksOf(source)
  const topLevel = topHeadingLevel(blocks)
  return blocks.map((b) => renderBlockWithHits(b, topLevel, wanted)).join('')
}

/** One line's spans as HTML, with every term occurrence wrapped in a mark. */
function inlineHits(raw: string, terms: readonly string[]): string {
  return inlineSpans(raw).map((span) => {
    const inner = litText(span.text, terms)
    return span.marks.reduceRight(
      (html, mark) => `<${TAG_OF[mark]}>${html}</${TAG_OF[mark]}>`, inner)
  }).join('')
}

/** Escaped text with each term occurrence wrapped, scanning case-insensitively. */
function litText(text: string, terms: readonly string[]): string {
  const lower = text.toLowerCase()
  let out = ''
  let i = 0
  while (i < text.length) {
    const hit = terms
      .map((t) => ({ t, at: lower.startsWith(t, i) }))
      .find((c) => c.at)
    if (!hit) {
      out += escapeHTML(text[i]!)
      i += 1
      continue
    }
    out += `<mark class="note-hit">${escapeHTML(text.slice(i, i + hit.t.length))}</mark>`
    i += hit.t.length
  }
  return out
}

function renderBlockWithHits(block: Block, topLevel: number, terms: readonly string[]): string {
  const item = (text: string): string => `<li>${inlineHits(text, terms)}</li>`
  switch (block.kind) {
    case 'p':
      return `<p>${block.lines.map((l) => inlineHits(l, terms)).join('<br>')}</p>`
    case 'h': {
      const tag = `h${3 + block.level - topLevel}`
      return `<${tag}>${inlineHits(block.text, terms)}</${tag}>`
    }
    case 'ul':
      return `<ul>${block.items.map(item).join('')}</ul>`
    case 'ol': {
      const start = block.start === 1 ? '' : ` start="${block.start}"`
      return `<ol${start}>${block.items.map(item).join('')}</ol>`
    }
  }
}
