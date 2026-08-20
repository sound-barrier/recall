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

// What a line already carries, so a second press removes it and a different
// button replaces it rather than stacking (`- # thing`).
const ANY_LINE_MARK = /^(#{1,2}\s+|[-*]\s+|\d{1,9}[.)]\s+)/

/** Prefix (or unprefix) every line the selection touches. */
export function applyLineMark(text: string, start: number, end: number, mark: LineMark): NoteEdit {
  const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1
  const lineEndIdx = text.indexOf('\n', end)
  const lineEnd = lineEndIdx === -1 ? text.length : lineEndIdx

  const block = text.slice(lineStart, lineEnd)
  const lines = block.split('\n')
  const prefixOf = (i: number): string => (mark === 'number' ? `${i + 1}. ` : LINE_PREFIX[mark])

  // Off only when EVERY touched line already carries this exact mark —
  // a partial selection gets marked rather than cleared.
  const allMarked = lines.every((line, i) => line.startsWith(prefixOf(i)))
  const next = lines
    .map((line, i) => {
      const bare = line.replace(ANY_LINE_MARK, '')
      return allMarked ? bare : prefixOf(i) + bare
    })
    .join('\n')

  const delta = next.length - block.length
  return {
    text: text.slice(0, lineStart) + next + text.slice(lineEnd),
    start: lineStart,
    end: end + delta,
  }
}
