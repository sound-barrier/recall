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

// Inline emphasis, applied to already-escaped text. Longest marker first so
// `**bold**` never matches as two italics. `[^\s]` on the open side and the
// close side is what keeps `ult_economy` and a lone `-5` literal: a marker
// must hug its content.
const INLINE: readonly { pattern: RegExp; tag: string }[] = [
  { pattern: /\*\*(\S(?:[\s\S]*?\S)?)\*\*/g, tag: 'strong' },
  { pattern: /~~(\S(?:[\s\S]*?\S)?)~~/g, tag: 'del' },
  { pattern: /\*(\S(?:[\s\S]*?\S)?)\*/g, tag: 'em' },
]

function inline(escaped: string): string {
  let out = escaped
  for (const { pattern, tag } of INLINE) {
    out = out.replace(pattern, (_m, body: string) => `<${tag}>${body}</${tag}>`)
  }
  return out
}

const HEADING = /^(#{1,2})\s+(.*)$/
const BULLET = /^[-*]\s+(.*)$/
const NUMBERED = /^(\d{1,9})[.)]\s+(.*)$/

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
  let open: Block | null = null
  const close = (): void => {
    if (open) blocks.push(open)
    open = null
  }

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '') {
      close()
      continue
    }
    const next = classify(line)
    if (next.kind === 'h') {
      close()
      blocks.push(next)
      continue
    }
    // Same kind as what is open → the line joins it; otherwise it starts one.
    if (open?.kind !== next.kind) {
      close()
      open = next
    } else {
      absorb(open, line)
    }
  }
  close()
  return blocks
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

function renderBlock(block: Block): string {
  const item = (text: string): string => `<li>${inline(escapeHTML(text))}</li>`
  switch (block.kind) {
    case 'p':
      return `<p>${block.lines.map((l) => inline(escapeHTML(l))).join('<br>')}</p>`
    case 'h':
      // A note's "title" is an h3: these render INSIDE a card that already
      // owns the page's h2, so starting at h1 would break the heading order
      // every a11y pass checks.
      return `<h${block.level + 2}>${inline(escapeHTML(block.text))}</h${block.level + 2}>`
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
  return blocksOf(source).map(renderBlock).join('')
}
