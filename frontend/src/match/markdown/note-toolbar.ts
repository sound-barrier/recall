// The note toolbar's text transforms — pure functions over (text, selection).
//
// The editor is CONTROLLED: it holds no draft, so a toolbar button cannot
// mutate a textarea and hope the draft catches up. Each button asks for the
// next (text, selection) pair and hands it upward, which is also what makes
// every one of these testable without a DOM.
//
// Two shapes. An INLINE mark wraps the selection (`**bold**`); a LINE mark
// prefixes every line the selection touches (`# `, `- `, `1. `). Both
// TOGGLE: pressing the button on something already marked takes the mark
// off, so a mis-click is one more click to undo rather than a mess to
// hand-edit.

/** What the caller applies: the new value and where to leave the cursor. */
export interface NoteEdit {
  text: string
  start: number
  end: number
}

export type InlineMark = 'bold' | 'italic' | 'strike'
export type LineMark = 'title' | 'subtitle' | 'bullet' | 'number'

const INLINE_MARKER: Record<InlineMark, string> = {
  bold: '**',
  italic: '*',
  strike: '~~',
}

/**
 * Wrap (or unwrap) the selection. An empty selection inserts the markers and
 * parks the cursor between them, so the button also means "start writing
 * something bold".
 */
export function applyInlineMark(text: string, start: number, end: number, mark: InlineMark): NoteEdit {
  const marker = INLINE_MARKER[mark]
  const selected = text.slice(start, end)
  const before = text.slice(0, start)
  const after = text.slice(end)

  // Already wrapped, either inside the selection or hugging it just outside.
  if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length > marker.length * 2) {
    const bare = selected.slice(marker.length, -marker.length)
    return { text: before + bare + after, start, end: start + bare.length }
  }
  if (before.endsWith(marker) && after.startsWith(marker)) {
    return {
      text: before.slice(0, -marker.length) + selected + after.slice(marker.length),
      start: start - marker.length,
      end: end - marker.length,
    }
  }
  const wrapped = marker + selected + marker
  return {
    text: before + wrapped + after,
    start: start + marker.length,
    end: start + marker.length + selected.length,
  }
}

const LINE_PREFIX: Record<Exclude<LineMark, 'number'>, string> = {
  title: '# ',
  subtitle: '## ',
  bullet: '- ',
}

// What each mark looks like once it is ON a line. A numbered line is ANY
// number, not the one this press would have written — otherwise pressing
// Numbered list on `1. a / 2. b / 3. c` with only the last two selected reads
// "not marked", renumbers from 1, and leaves `1. 1. 2.` in the textarea.
const LINE_MARK_RE: Record<LineMark, RegExp> = {
  title: /^#[ \t]+/,
  subtitle: /^##[ \t]+/,
  bullet: /^[-*][ \t]+/,
  number: /^(\d{1,9})[.)][ \t]+/,
}

// Any mark, so a different button REPLACES rather than stacking (`- # thing`).
const ANY_LINE_MARK = /^(#{1,2}[ \t]+|[-*][ \t]+|\d{1,9}[.)][ \t]+)/

/**
 * Where a numbered list starting at `lineStart` counts from: one past the
 * line above when that line is already numbered, so marking the tail of a
 * list continues it instead of restarting it.
 */
function numberStart(text: string, lineStart: number): number {
  if (lineStart === 0) return 1
  const prevStart = text.lastIndexOf('\n', lineStart - 2) + 1
  const prev = LINE_MARK_RE.number.exec(text.slice(prevStart, lineStart - 1))
  return prev ? Number(prev[1]) + 1 : 1
}

/** Prefix (or unprefix) every line the selection touches. */
export function applyLineMark(text: string, start: number, end: number, mark: LineMark): NoteEdit {
  const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1
  const lineEndIdx = text.indexOf('\n', end)
  const lineEnd = lineEndIdx === -1 ? text.length : lineEndIdx

  const block = text.slice(lineStart, lineEnd)
  const lines = block.split('\n')
  const from = mark === 'number' ? numberStart(text, lineStart) : 0
  const prefixOf = (i: number): string => (mark === 'number' ? `${from + i}. ` : LINE_PREFIX[mark])

  // Off only when EVERY touched line already carries this mark — a partial
  // selection gets marked rather than cleared.
  const allMarked = lines.every((line) => LINE_MARK_RE[mark].test(line))
  const next = lines.map((line, i) => {
    const bare = line.replace(ANY_LINE_MARK, '')
    return allMarked ? bare : prefixOf(i) + bare
  })

  // Move the selection BY what changed rather than snapping it to the start
  // of the block: a line button pressed with a collapsed caret must leave a
  // collapsed caret, or the very next keystroke deletes the line it marked.
  const firstDelta = next[0]!.length - lines[0]!.length
  const totalDelta = next.join('\n').length - block.length
  return {
    text: text.slice(0, lineStart) + next.join('\n') + text.slice(lineEnd),
    start: Math.max(lineStart, start + firstDelta),
    end: Math.max(lineStart, end + totalDelta),
  }
}
