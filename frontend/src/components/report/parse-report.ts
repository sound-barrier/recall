import type { LikelyCause, MatchRecord, ReportFile } from '@/api-client'
import { ISSUES_URL } from '@/app-links'

/** One screenshot the parse-problem report can include. dirId 0 = the configured folder. */
export interface ReportCandidate {
  filename: string
  dirId: number
}

/** The issue form the prefilled link opens — `.github/ISSUE_TEMPLATE/<this>`. */
const PARSE_PROBLEM_TEMPLATE = 'parse_problem.yml'

/**
 * Past this many screenshots a report usually outgrows GitHub's 25 MB
 * attachment limit (~1.5 MB per capture plus about 1 MB of crops each).
 */
export const LARGE_REPORT_FILES = 8

export function candidateKey(c: ReportCandidate): string {
  return `${c.dirId}/${c.filename}`
}

export function candidatesFromRecord(rec: Pick<MatchRecord, 'source_files' | 'source_dir_ids'>): ReportCandidate[] {
  return (rec.source_files ?? []).map((filename) => ({ filename, dirId: rec.source_dir_ids?.[filename] ?? 0 }))
}

// Failed files carry no folder on the wire: the server joins them back to the
// failure ledger, which knows where each one failed.
export function candidatesFromFailed(files: readonly { filename: string }[]): ReportCandidate[] {
  return files.map(({ filename }) => ({ filename, dirId: 0 }))
}

export function reportFiles(picked: readonly ReportCandidate[], notes: Readonly<Record<string, string>>): ReportFile[] {
  return picked.map((c) => ({
    filename: c.filename,
    screenshots_dir_id: c.dirId,
    note: (notes[candidateKey(c)] ?? '').trim(),
  }))
}

/** Findings about the Tesseract install rather than one file. */
export function setupCauses(causes: readonly LikelyCause[]): LikelyCause[] {
  return causes.filter((c) => !c.filename)
}

export function causesForFile(causes: readonly LikelyCause[], filename: string): LikelyCause[] {
  return causes.filter((c) => c.filename === filename)
}

export interface IssueContext {
  files: readonly ReportFile[]
  recallVersion: string
  platform: string
  tesseractVersion: string
}

const TITLE_NOTE_MAX = 60

/**
 * The new-issue URL for the parse-problem form, prefilled from the report:
 * GitHub fills an issue form's fields from query parameters named by field id.
 * The zip itself can't ride a URL — the user drags it into the form.
 */
export function parseProblemIssueURL(ctx: IssueContext): string {
  const params = new URLSearchParams({
    template: PARSE_PROBLEM_TEMPLATE,
    title: `[parse]: ${issueTitle(ctx.files)}`,
    version: ctx.recallVersion,
    environment: `${ctx.platform || 'unknown OS'} · Tesseract ${ctx.tesseractVersion || 'not found'}`,
    files: ctx.files.map((f) => `- ${f.filename}: ${f.note || '(no note)'}`).join('\n'),
  })
  return `${ISSUES_URL}/new?${params.toString()}`
}

function issueTitle(files: readonly ReportFile[]): string {
  const note = files.find((f) => f.note)?.note ?? ''
  if (!note) return `${files.length} screenshot${files.length === 1 ? '' : 's'} read wrong`
  return note.length > TITLE_NOTE_MAX ? `${note.slice(0, TITLE_NOTE_MAX - 1)}…` : note
}
