import type { MatchRecord } from '@/api-client'
import { sourceType } from '@/match/match-helpers'

// Single-match markdown rendering for coach review / blog paste
// (matchToMarkdown: title + stats table + journal + screenshot refs)
// and the compact Discord one-liner (matchSummaryLine). Pure — the
// detail panel copies the output to the clipboard; no transport, no
// side effects. Empty fields drop out rather than rendering blanks.

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

export function matchToMarkdown(rec: MatchRecord, opts: MatchMarkdownOptions = {}): string {
  const d = rec.data ?? {}
  const map = opts.mapDisplay || d.map || 'Unknown map'
  const hero = opts.heroDisplay || d.hero || ''
  const title = [map, d.result, d.date ? `(${d.date})` : '']
    .filter(Boolean)
    .join(' — ')
    .replace(' — (', ' (')

  const stats: [string, string][] = []
  if (hero) stats.push(['Hero', hero])
  if (d.result) stats.push(['Result', d.result])
  if (d.final_score) stats.push(['Final score', d.final_score])
  const ead = eadLine(rec)
  if (ead) stats.push(['E / A / D', ead])
  if (d.damage) stats.push(['Damage', String(d.damage)])
  if (d.healing) stats.push(['Healing', String(d.healing)])
  if (d.mitigation) stats.push(['Mitigation', String(d.mitigation)])
  if (d.game_length) stats.push(['Game length', d.game_length])

  const lines: string[] = [`# ${title}`, '']
  if (stats.length > 0) {
    lines.push('| Stat | Value |', '|---|---|')
    for (const [k, v] of stats) lines.push(`| ${k} | ${v} |`)
    lines.push('')
  }

  const a = rec.annotation
  const journal: string[] = []
  if (a?.note) journal.push(`> ${a.note.replace(/\n/g, '\n> ')}`, '')
  if (a?.replay_code) journal.push(`- Replay: \`${a.replay_code}\``)
  if (a?.members?.length) journal.push(`- Squad: ${a.members.join(', ')}`)
  if (a?.tags?.length) journal.push(`- Tags: ${a.tags.map(t => `#${t}`).join(' ')}`)
  if (journal.length > 0) {
    lines.push('## Journal', '', ...journal, '')
  }

  if (rec.source_files?.length) {
    lines.push('## Screenshots', '')
    for (const f of rec.source_files) {
      const t = sourceType(rec, f)
      lines.push(`- \`${f}\`${t ? ` (${t})` : ''}`)
    }
    lines.push('')
  }
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
