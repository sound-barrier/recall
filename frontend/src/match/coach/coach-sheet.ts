import { escapeHTML, renderMarkdown } from '@/match/markdown/render-markdown'

/**
 * The page a coach hands over.
 *
 * A player who does not want to import anything — or does not run Recall at
 * all — should still be able to read their review. This builds one
 * self-contained HTML file they can open in any browser, offline, forever:
 * no scripts, no images, no links, no fonts, nothing that reaches out.
 *
 * Two rules keep it honest, and both are enforced by the test beside this
 * file rather than by good intentions:
 *
 *   1. EVERY interpolation goes through `escapeHTML` or `renderMarkdown`.
 *      This used to be a Go `html/template`, whose contextual auto-escaping
 *      made an unescaped interpolation impossible. String concatenation
 *      offers no such protection, so the forbidden-substring test stopped
 *      being belt-and-braces and became the actual defense.
 *
 *   2. The CSS arrives as a PARAMETER. The caller inlines the app's real
 *      stylesheets, so the sheet and the app cannot drift — but the builder
 *      itself stays pure, which is what makes it testable. (Under Vitest a
 *      `?inline` import resolves to the empty string, so a builder that
 *      imported its own CSS would let "the sheet contains no url(" pass
 *      against an empty <style> and prove nothing.)
 */

/** One timestamped thing the coach marked inside a match. */
interface SheetMoment {
  matchClock: string
  text: string
}

/** What the coach knew about the match a note is about. */
interface SheetMatch {
  map: string
  hero: string
  result: string
  date: string
  finishedAt: string
  replayCode: string
}

interface SheetNote {
  matchKey: string
  kind: string
  text: string
  focusTags: string[]
  extraTags: string[]
  matchClock: string
  match: SheetMatch | null
  moments: SheetMoment[]
}

export interface CoachSheetInput {
  coachName: string
  playerHandle: string
  sessionDate: string
  focusItems: { text: string }[]
  notes: SheetNote[]
}

/** "ult_economy" reads "ult economy" — the same display rule the app uses. */
function tagLabel(tag: string): string {
  return escapeHTML(tag.replace(/_/g, ' '))
}

/**
 * The match line: as much as the coach knew, and nothing invented.
 *
 * A replay match may have only a code behind it, which is precisely the case
 * this sheet exists for — so the parts are collected and joined rather than
 * templated, and a match nobody described falls back to naming its key.
 */
function matchLine(note: SheetNote): string {
  const m = note.match
  if (!m) return `<span class="sheet-key">${escapeHTML(note.matchKey)}</span>`

  const parts = [m.map, m.hero, m.result, m.date, m.finishedAt]
    .filter((p) => p !== '')
    .map(escapeHTML)
  if (m.replayCode !== '') {
    parts.push(`<span class="sheet-key">${escapeHTML(m.replayCode)}</span>`)
  }
  if (parts.length === 0) return `<span class="sheet-key">${escapeHTML(note.matchKey)}</span>`
  return parts.join('<span class="sheet-dot">·</span>')
}

function momentsBlock(moments: SheetMoment[]): string {
  if (moments.length === 0) return ''
  const rows = moments
    .map((m) => `<li><span class="sheet-clock">${escapeHTML(m.matchClock)}</span>`
      + `<span class="sheet-moment-text">${escapeHTML(m.text)}</span></li>`)
    .join('')
  return `<ul class="sheet-moments">${rows}</ul>`
}

function tagsBlock(note: SheetNote): string {
  const tags = [...note.focusTags, ...note.extraTags]
  if (tags.length === 0) return ''
  return `<p class="sheet-tags">${tags.map((t) => `<span class="sheet-tag">${tagLabel(t)}</span>`).join('')}</p>`
}

function noteBlock(note: SheetNote): string {
  // A reviewed-only note is a match the coach watched and had nothing to add.
  // Saying so is the point — silence would read as an oversight.
  const body = note.kind === 'reviewed_only'
    ? '<p class="sheet-reviewed">Watched — nothing to add.</p>'
    : `<div class="note-prose">${renderMarkdown(note.text)}</div>`
  const clock = note.matchClock === ''
    ? ''
    : `<span class="sheet-clock">${escapeHTML(note.matchClock)}</span>`
  return `<article class="sheet-note">`
    + `<h3 class="sheet-match">${matchLine(note)}${clock}</h3>`
    + body + tagsBlock(note) + momentsBlock(note.moments)
    + `</article>`
}

function focusBlock(items: { text: string }[]): string {
  if (items.length === 0) return ''
  const rows = items.map((i) => `<li>${escapeHTML(i.text)}</li>`).join('')
  return `<section class="sheet-focus">`
    + `<h2 class="sheet-h2">What to work on</h2>`
    + `<ol class="sheet-focus-list">${rows}</ol>`
    + `</section>`
}

/**
 * Renders the sheet. `css` is embedded verbatim in a single <style> block —
 * the caller is responsible for it being the app's own stylesheets.
 */
export function buildCoachSheet(input: CoachSheetInput, css: string): string {
  const notes = input.notes.map(noteBlock).join('')
  const notesSection = notes === ''
    ? ''
    : `<section class="sheet-notes"><h2 class="sheet-h2">The matches</h2>${notes}</section>`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHTML(input.playerHandle)} — coaching review</title>
<style>${css}</style>
</head>
<body class="paper sheet">
<main class="sheet-page">
<header class="sheet-head">
<p class="eyebrow">Coaching review</p>
<h1 class="sheet-h1">${escapeHTML(input.playerHandle)}</h1>
<p class="sheet-by">from ${escapeHTML(input.coachName)} <span class="sheet-dot">·</span> ${escapeHTML(input.sessionDate)}</p>
</header>
${focusBlock(input.focusItems)}
${notesSection}
</main>
</body>
</html>`
}

/**
 * The shapes the sheet is assembled from, narrowed to what it reads.
 *
 * Notes arrive as DRAFTS — what the room is showing right now — rather than
 * as the session's server-side copy. Those two are not the same thing: a
 * note is saved by a debounced autosave and the session view is not re-read
 * after it lands, so building from the server copy meant the sentence a
 * coach typed thirty seconds before pressing Export was missing from the
 * file. Found by the e2e; nothing else would have.
 */
interface SheetSourceNote {
  matchKey: string
  kind: string
  text: string
  focusTags: string[]
  extraTags: string[]
  matchClock: string
}

interface SheetSourceRecord {
  match_key: string
  data?: {
    map?: string
    hero?: string
    result?: string
    date?: string
    finished_at?: string
  }
  annotation?: { replay_code?: string } | null
}

export interface SheetSource {
  coachName: string
  playerHandle: string
  sessionDate: string
  focusItems: { text: string }[]
  notes: SheetSourceNote[]
  records: SheetSourceRecord[]
  momentsByKey: Record<string, { matchClock: string; text: string }[]>
}

/** What the coach recorded about one match, or null if they recorded nothing. */
function matchOf(rec: SheetSourceRecord | undefined): SheetMatch | null {
  if (!rec?.data) return null
  const d = rec.data
  return {
    map: d.map ?? '',
    hero: d.hero ?? '',
    result: d.result ?? '',
    date: d.date ?? '',
    finishedAt: d.finished_at ?? '',
    replayCode: rec.annotation?.replay_code ?? '',
  }
}

/**
 * Folds the session's wire shapes into what the sheet renders.
 *
 * Lives here rather than in the store because it is pure — the store's job
 * is the session, not the shape of a document — and because a mapping this
 * full of fallbacks is worth being able to test on its own.
 */
export function toSheetInput(src: SheetSource): CoachSheetInput {
  const byKey = new Map(src.records.map((r) => [r.match_key, r]))
  return {
    coachName: src.coachName,
    playerHandle: src.playerHandle,
    sessionDate: src.sessionDate,
    focusItems: src.focusItems.map((i) => ({ text: i.text })),
    notes: src.notes.map((n) => ({
      matchKey: n.matchKey,
      kind: n.kind,
      text: n.text,
      focusTags: [...n.focusTags],
      extraTags: [...n.extraTags],
      matchClock: n.matchClock,
      match: matchOf(byKey.get(n.matchKey)),
      moments: src.momentsByKey[n.matchKey] ?? [],
    })),
  }
}
