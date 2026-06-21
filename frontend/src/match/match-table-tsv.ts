import type { MatchRecord } from '@/api-client'
import type { TableSortCol } from '@/composables/matches/useTableSort'
import {
  formatRowDate,
  formatFinishedAt,
  isEditedMatch,
  isManualMatch,
  rolePlays,
  sortedHeroPlays,
} from '@/match/match-helpers'
import { formatPlayModeLabel, formatQueueTypeLabel } from '@/match/match-label-helpers'

type HeroRole = (hero: string | null | undefined) => string

// cellText is the displayed value of a data-table cell, used to build the TSV
// clipboard payload from a cell-range selection. Mirrors what the cell renders
// (multi-value hero/role/tags join with their in-cell separators).
export function cellText(rec: MatchRecord, col: TableSortCol, heroRole: HeroRole): string {
  const d = rec.data
  switch (col) {
    case 'date':         return [formatRowDate(rec), formatFinishedAt(rec)].filter(Boolean).join(' ')
    case 'map':          return d?.map ?? ''
    case 'playMode':     return formatPlayModeLabel(rec)
    case 'queue':        return formatQueueTypeLabel(rec)
    case 'hero':         return sortedHeroPlays(rec).map((h) => h.hero).join(', ')
    case 'role':         return rolePlays(rec, heroRole).map((r) => r.role).join(', ')
    case 'eliminations': return d?.eliminations != null ? String(d.eliminations) : ''
    case 'assists':      return d?.assists != null ? String(d.assists) : ''
    case 'deaths':       return d?.deaths != null ? String(d.deaths) : ''
    case 'tags':         return (rec.annotation?.tags ?? []).join('; ')
    case 'edited':       return isEditedMatch(rec) ? 'yes' : ''
    case 'manual':       return isManualMatch(rec) ? 'yes' : ''
    case 'result':       return d?.result ?? ''
  }
}

// buildSelectionTsv renders the selected rectangle as tab-separated rows — one
// line per record, cells tab-joined — so it pastes into Excel/Sheets as a grid.
export function buildSelectionTsv(rows: MatchRecord[], cols: TableSortCol[], heroRole: HeroRole): string {
  return rows.map((rec) => cols.map((c) => cellText(rec, c, heroRole)).join('\t')).join('\n')
}
