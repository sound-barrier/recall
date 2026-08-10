import type { MatchRecord } from '@/api-client'
import {
  TABLE_COLUMNS,
  type HeroRole,
  type TableSortCol,
} from '@/match/match-table-columns'

// cellText is the displayed value of a data-table cell, used to build the TSV
// clipboard payload from a cell-range selection. The per-column rendering
// lives on the TABLE_COLUMNS registry so it can never drift from the sort
// axis or the header labels.
export function cellText(rec: MatchRecord, col: TableSortCol, heroRole: HeroRole): string {
  return TABLE_COLUMNS[col].text(rec, heroRole)
}

// buildSelectionTsv renders the selected rectangle as tab-separated rows — one
// line per record, cells tab-joined — so it pastes into Excel/Sheets as a grid.
export function buildSelectionTsv(rows: MatchRecord[], cols: TableSortCol[], heroRole: HeroRole): string {
  return rows.map((rec) => cols.map((c) => cellText(rec, c, heroRole)).join('\t')).join('\n')
}
