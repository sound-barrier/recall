/**
 * Flat CSV export, the high-value version: a MIXED, real-server match set whose
 * rows have different provenance, exported through the actual selection → save
 * chain, then parsed back with a real RFC-4180 reader.
 *
 * Two bug surfaces this guards that the mocked csv spec cannot:
 *
 *  1. OVERRIDE-OVER-OCR. A match parsed from a real screenshot, then edited in
 *     many fields, must export the EDITED values — never the stale OCR
 *     originals. The user override layer (user_match_data) has to shadow the
 *     parsed row in the first-non-empty-wins aggregation fold, survive
 *     GetMatchResults, and reach matchesToCSV. A regression that let the OCR
 *     value win would be invisible in the UI's happy path but corrupt every
 *     exported sheet. We assert the edited cells hold sentinel values and the
 *     row's `source` flipped to ocr_edited.
 *
 *  2. EXCEL-VALID CSV. "Importable as a single file into Excel" means RFC-4180:
 *     a cell containing a comma, a doubled quote, or an embedded newline must
 *     round-trip to the exact original string, and the row grain must stay one
 *     match per record even when a note carries a newline. We plant that
 *     torture note on a manual match and parse the download with a real
 *     quote-aware reader (a naive split would mis-count the rows).
 *
 * The only way to mint a genuine ocr_edited match over HTTP is to parse a real
 * screenshot (OCR rows can't be injected via the API), so this drives the same
 * Tesseract pipeline as golden-parse.spec.ts. OCR output drifts across versions,
 * so we assert hard ONLY on the fields we edited (known sentinels) — never on
 * what the golden happened to OCR to.
 */
import fs from 'node:fs'

import { expect, test } from './_fixtures'
import { createMatch, manual, parseGolden, reset, stageGolden, unstageGolden } from './_real-server'

// The export's column contract (matchesToCSV / MATCH_CSV_HEADERS), in order.
// Pinned here so a reorder/rename is a deliberate, reviewed change.
const EXPECTED_HEADER =
  'match_key,date,finished_at,game_length,map,game_mode,playlist,play_mode,queue_type,result,' +
  'final_score,role,hero,heroes_played,eliminations,assists,deaths,damage,healing,mitigation,' +
  'rank,level,reviewed_by,source,leaver,note,replay_code,members,tags'

// The full override set we apply to the parsed match. Every value is a
// distinctive in-range sentinel so its presence in the CSV is unambiguous.
// `map` is included so the parsed row is never an unknown-map record (those are
// hidden from the default data view and would not be selectable).
const EDITS = {
  map: 'ilios',
  result: 'defeat',
  final_score: '3-1',
  finished_at: '23:45',
  game_length: '12:34',
  eliminations: 42,
  assists: 38,
  deaths: 13,
  damage: 54321,
  healing: 43210,
  mitigation: 32109,
} as const

// A cell that exercises every RFC-4180 escape at once.
const TORTURE_NOTE = 'comma, "quoted", and a\nnewline'
const TORTURE_TAGS = ['a,b', 'c"d']

/**
 * Minimal RFC-4180 reader. Quoted fields keep their commas, doubled quotes
 * (→ one literal quote), and embedded newlines; unquoted CRLF / LF ends a row.
 * This is what proves the file would import into a spreadsheet as one table —
 * a `split('\n')` cannot, which is the whole point.
 */
function parseCSV(input: string): string[][] {
  let text = input
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) // strip UTF-8 BOM
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      quoted = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\r') {
      // swallow — the paired \n closes the row
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += c
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

// sheetByKey turns the parsed grid into a header->cell map per match_key.
function sheetByKey(rows: string[][]) {
  const headers = rows[0]
  const keyIdx = headers.indexOf('match_key')
  const byKey = new Map<string, Record<string, string>>()
  for (const r of rows.slice(1)) {
    const rec: Record<string, string> = {}
    headers.forEach((h, i) => (rec[h] = r[i] ?? ''))
    byKey.set(r[keyIdx], rec)
  }
  return { headers, byKey, dataRowCount: rows.length - 1 }
}

test.describe('flat CSV export of a mixed match set (real server)', () => {
  test.beforeEach(async ({ request }) => {
    await reset(request)
    stageGolden()
  })

  test.afterEach(async ({ request }) => {
    await reset(request)
    await unstageGolden(request)
  })

  test('exports the selected set with edited fields, not the OCR originals', async ({ page, request }) => {
    // ── Mint a genuine OCR match by parsing a real screenshot ──────────────
    const ocrKey = (await parseGolden(request)).match_key

    // ── Edit many fields on it (the override layer) ────────────────────────
    expect([200, 204]).toContain(
      (await request.put(`/api/v1/matches/${ocrKey}/data`, { data: EDITS })).status(),
    )

    // ── Two manual matches; one carries the RFC-4180 torture annotation ────
    const noted = await createMatch(
      request,
      manual({
        played_at: '2026-06-15T18:00:00Z',
        map: 'ilios',
        heroes: ['ana'],
        result: 'victory',
        queue_type: 'open',
        note: TORTURE_NOTE,
        tags: TORTURE_TAGS,
      }),
    )
    const plain = await createMatch(
      request,
      manual({ played_at: '2026-06-15T18:01:00Z', map: 'rialto', heroes: ['kiriko'], result: 'defeat', queue_type: 'role' }),
    )
    // A fourth match we deliberately do NOT select — it must be absent.
    const excluded = await createMatch(
      request,
      manual({ played_at: '2026-06-15T18:02:00Z', map: 'oasis', heroes: ['lucio'], result: 'victory' }),
    )

    // ── Drive the real UI: data density, tick three rows, export ───────────
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.seg-btn', { hasText: 'Data' }).click()
    await expect(page.locator('table.leaves-table')).toBeVisible()

    for (const key of [ocrKey, noted.match_key, plain.match_key]) {
      const row = page.locator(`tr.table-row[data-match-key="${key}"]`)
      await row.scrollIntoViewIfNeeded()
      await row.hover()
      await row.locator('.leaf-checkbox').click()
      await expect(row).toHaveClass(/is-ticked/)
    }

    const downloadPromise = page.waitForEvent('download')
    await page.locator('[data-testid="export-csv"]').click()
    const download = await downloadPromise

    const content = fs.readFileSync((await download.path())!, 'utf8')

    // ── Valid, Excel-ready CSV ─────────────────────────────────────────────
    expect(content.startsWith('﻿'), 'UTF-8 BOM so Excel detects the encoding').toBe(true)
    const { headers, byKey, dataRowCount } = sheetByKey(parseCSV(content))
    expect(headers.join(',')).toBe(EXPECTED_HEADER)
    // One row per SELECTED match — even though a note holds an embedded newline.
    expect(dataRowCount).toBe(3)
    expect(byKey.has(excluded.match_key)).toBe(false)
    // Rectangular: every row has exactly one cell per column (Excel needs this).
    for (const rec of byKey.values()) {
      expect(Object.keys(rec)).toHaveLength(headers.length)
    }

    // ── The edited OCR match exports the EDITS, not the OCR originals ───────
    const ocr = byKey.get(ocrKey)!
    expect(ocr.source).toBe('ocr_edited')
    expect(ocr.map).toBe('ilios')
    expect(ocr.result).toBe('defeat')
    expect(ocr.final_score).toBe('3-1')
    expect(ocr.finished_at).toBe('23:45')
    expect(ocr.game_length).toBe('12:34')
    expect(ocr.eliminations).toBe('42')
    expect(ocr.assists).toBe('38')
    expect(ocr.deaths).toBe('13')
    expect(ocr.damage).toBe('54321')
    expect(ocr.healing).toBe('43210')
    expect(ocr.mitigation).toBe('32109')

    // ── The user-entered matches export cleanly; the torture cell survives ─
    const m = byKey.get(noted.match_key)!
    expect(m.source).toBe('manual')
    expect(m.result).toBe('victory')
    expect(m.map).toBe('ilios')
    expect(m.queue_type).toBe('open')
    expect(m.note).toBe(TORTURE_NOTE) // comma + doubled-quote + newline, exact
    expect(m.tags).toBe('a,b; c"d') // "; "-joined, re-parsed past the comma/quote

    expect(byKey.get(plain.match_key)!.source).toBe('manual')
    expect(byKey.get(plain.match_key)!.result).toBe('defeat')
  })
})
