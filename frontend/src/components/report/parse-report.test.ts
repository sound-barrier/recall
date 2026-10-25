import { describe, expect, it } from 'vitest'

import {
  candidatesFromFailed,
  candidatesFromRecord,
  causesForFile,
  parseProblemIssueURL,
  reportFiles,
  setupCauses,
} from '@/components/report/parse-report'

describe('report candidates', () => {
  it('carry each source file with the folder it was ingested from', () => {
    const rec = { source_files: ['a.png', 'b.png'], source_dir_ids: { 'a.png': 3 } }
    expect(candidatesFromRecord(rec)).toEqual([
      { filename: 'a.png', dirId: 3 },
      { filename: 'b.png', dirId: 0 },
    ])
  })

  it('leave a failed file’s folder to the server’s ledger', () => {
    expect(candidatesFromFailed([{ filename: 'bad.png' }])).toEqual([{ filename: 'bad.png', dirId: 0 }])
  })

  it('become wire files with their trimmed notes', () => {
    const picked = [{ filename: 'a.png', dirId: 3 }, { filename: 'b.png', dirId: 0 }]
    expect(reportFiles(picked, { '3/a.png': '  hero should be Kiriko ' })).toEqual([
      { filename: 'a.png', screenshots_dir_id: 3, note: 'hero should be Kiriko' },
      { filename: 'b.png', screenshots_dir_id: 0, note: '' },
    ])
  })
})

describe('likely causes', () => {
  const causes = [
    { code: 'tesseract_unsupported' as const, message: 'old tesseract' },
    { code: 'unusual_aspect_ratio' as const, filename: 'wide.png', message: 'ultrawide' },
  ]

  it('split the install findings from the per-file ones', () => {
    expect(setupCauses(causes).map((c) => c.message)).toEqual(['old tesseract'])
    expect(causesForFile(causes, 'wide.png').map((c) => c.message)).toEqual(['ultrawide'])
    expect(causesForFile(causes, 'other.png')).toEqual([])
  })
})

describe('parseProblemIssueURL', () => {
  const base = { recallVersion: '0.33.5', platform: 'windows', tesseractVersion: '5.3.4' }

  it('prefills the parse-problem form from the report', () => {
    const url = new URL(parseProblemIssueURL({
      ...base,
      files: [
        { filename: 'a.png', screenshots_dir_id: 3, note: 'hero should be Kiriko' },
        { filename: 'b.png', screenshots_dir_id: 0, note: '' },
      ],
    }))
    expect(url.origin + url.pathname).toBe('https://github.com/sound-barrier/recall/issues/new')
    expect(url.searchParams.get('template')).toBe('parse_problem.yml')
    expect(url.searchParams.get('title')).toBe('[parse]: hero should be Kiriko')
    expect(url.searchParams.get('version')).toBe('0.33.5')
    expect(url.searchParams.get('environment')).toBe('windows · Tesseract 5.3.4')
    expect(url.searchParams.get('files')).toBe('- a.png: hero should be Kiriko\n- b.png: (no note)')
  })

  it('titles a report with no notes by its size, and says when Tesseract is missing', () => {
    const url = new URL(parseProblemIssueURL({
      ...base, tesseractVersion: '',
      files: [{ filename: 'a.png', note: '' }, { filename: 'b.png', note: '' }],
    }))
    expect(url.searchParams.get('title')).toBe('[parse]: 2 screenshots read wrong')
    expect(url.searchParams.get('environment')).toBe('windows · Tesseract not found')
  })

  it('cuts a long first note down for the title', () => {
    const url = new URL(parseProblemIssueURL({ ...base, files: [{ filename: 'a.png', note: 'x'.repeat(200) }] }))
    expect(url.searchParams.get('title')).toBe(`[parse]: ${'x'.repeat(59)}…`)
  })
})
