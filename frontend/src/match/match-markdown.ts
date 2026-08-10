import type { MatchRecord } from '@/api-client'
import { sourceType } from '@/match/match-helpers'

// Single-match markdown rendering for coach review / blog paste
// (matchToMarkdown: title + stats table + journal + screenshot refs)
// and the compact Discord one-liner (matchSummaryLine). Pure — the
// detail panel copies the output to the clipboard; no transport, no
// side effects. Empty fields drop out rather than rendering blanks:
// each section is a spec table of label + extractor rows filtered on
// truthiness.

export interface MatchMarkdownOptions {
  // Pre-resolved display names (useOWData); raw stored tokens are the
  // fallback so the helpers stay pure and store-free.
  mapDisplay?: string
  heroDisplay?: string
}

function eadLine(rec: MatchRecord): string {
  const d = rec.data ?? {}
  if (!d.eliminations && !d.assists && !d.deaths) return ''
  return `${d.eliminations ?? 0} / ${d.assists ?? 0} / ${d.deaths ?? 0}`
}

function titleLine(rec: MatchRecord, opts: MatchMarkdownOptions): string {
  const d = rec.data ?? {}
  const map = opts.mapDisplay || d.map || 'Unknown map'
  return [map, d.result, d.date ? `(${d.date})` : '']
    .filter(Boolean)
    .join(' — ')
    .replace(' — (', ' (')
}

const STAT_ROWS: ReadonlyArray<{
  label: string
  value: (rec: MatchRecord, hero: string) => string | number | undefined
}> = [
  { label: 'Hero',        value: (_rec, hero) => hero },
  { label: 'Result',      value: (rec) => rec.data?.result },
  { label: 'Final score', value: (rec) => rec.data?.final_score },
  { label: 'E / A / D',   value: (rec) => eadLine(rec) },
  { label: 'Damage',      value: (rec) => rec.data?.damage },
  { label: 'Healing',     value: (rec) => rec.data?.healing },
  { label: 'Mitigation',  value: (rec) => rec.data?.mitigation },
  { label: 'Game length', value: (rec) => rec.data?.game_length },
]

function statsTableLines(rec: MatchRecord, hero: string): string[] {
  const rows = STAT_ROWS
    .map(({ label, value }) => ({ label, value: value(rec, hero) }))
    .filter((row) => row.value)
  if (rows.length === 0) return []
  return [
    '| Stat | Value |',
    '|---|---|',
    ...rows.map((row) => `| ${row.label} | ${String(row.value)} |`),
    '',
  ]
}

const JOURNAL_ROWS: ReadonlyArray<(a: NonNullable<MatchRecord['annotation']>) => string[]> = [
  // The note renders as a quote block followed by a blank line so
  // the bullet rows below it start their own paragraph.
  (a) => (a.note ? [`> ${a.note.replace(/\n/g, '\n> ')}`, ''] : []),
  (a) => (a.replay_code ? [`- Replay: \`${a.replay_code}\``] : []),
  (a) => (a.members?.length ? [`- Squad: ${a.members.join(', ')}`] : []),
  (a) => (a.tags?.length ? [`- Tags: ${a.tags.map(t => `#${t}`).join(' ')}`] : []),
]

function journalLines(a: MatchRecord['annotation']): string[] {
  if (!a) return []
  const journal = JOURNAL_ROWS.flatMap((row) => row(a))
  if (journal.length === 0) return []
  return ['## Journal', '', ...journal, '']
}

function screenshotLines(rec: MatchRecord): string[] {
  if (!rec.source_files?.length) return []
  const refs = rec.source_files.map((f) => {
    const t = sourceType(rec, f)
    return `- \`${f}\`${t ? ` (${t})` : ''}`
  })
  return ['## Screenshots', '', ...refs, '']
}

export function matchToMarkdown(rec: MatchRecord, opts: MatchMarkdownOptions = {}): string {
  const d = rec.data ?? {}
  const hero = opts.heroDisplay || d.hero || ''
  const lines = [
    `# ${titleLine(rec, opts)}`,
    '',
    ...statsTableLines(rec, hero),
    ...journalLines(rec.annotation),
    ...screenshotLines(rec),
  ]
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

// matchSummaryLine renders the paste-into-Discord one-liner:
// "rialto · lucio · 17/16/11 · victory · AB12CD". Single line, empty
// parts dropped.
export function matchSummaryLine(rec: MatchRecord, opts: MatchMarkdownOptions = {}): string {
  const d = rec.data ?? {}
  const ead = eadLine(rec).replace(/ \/ /g, '/')
  return [
    opts.mapDisplay || d.map,
    opts.heroDisplay || d.hero,
    ead,
    d.result,
    rec.annotation?.replay_code,
  ].filter(Boolean).join(' · ')
}
