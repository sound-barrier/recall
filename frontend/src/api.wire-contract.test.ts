import { describe, it, expect, vi, afterEach } from 'vitest'

import * as api from '@/api'

// api.ts is a pure mapping layer: each exported name binds an app-facing
// call to ONE generated SDK operation, with the path params and request
// body it must send. That mapping IS the module's whole behavior — a
// wrapper pointed at the wrong operationId (copy-pasted from its sibling)
// compiles, type-checks, and silently talks to the wrong endpoint. The
// verb also carries meaning here: '' clears a per-match tag via DELETE
// while a value upserts via PUT (see .claude/rules/api-design.md), so a
// verb slip turns "clear" into "write empty".
//
// This table is that contract, one row per wrapper. It asserts on the
// Request the generated client built — method, root-relative path, query
// string, and (for writers) the exact JSON body.

function stubFetch() {
  const spy = vi.fn(async (_req: Request) => new Response(JSON.stringify({}), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }))
  vi.stubGlobal('fetch', spy)
  return spy
}

function lastRequest(spy: ReturnType<typeof stubFetch>): Request {
  const req = spy.mock.lastCall?.[0]
  if (!req) throw new Error('fetch was not called')
  return req
}

afterEach(() => { vi.unstubAllGlobals() })

const KEY = 'match-2026-05-10T22-21-11'

interface WireCase {
  name:    string
  call:    () => Promise<unknown>
  method:  'GET' | 'PUT' | 'POST' | 'DELETE'
  path:    string
  search?: string
  body?:   unknown
}

const SYSTEM: WireCase[] = [
  { name: 'GetStartupError',     call: () => api.GetStartupError(),     method: 'GET',  path: '/api/v1/system/startup-error' },
  { name: 'CheckForUpdate',      call: () => api.CheckForUpdate(),      method: 'GET',  path: '/api/v1/system/update' },
  { name: 'ApplyGameDataUpdate', call: () => api.ApplyGameDataUpdate(), method: 'POST', path: '/api/v1/system/data-update' },
  { name: 'StartSelfUpdate',     call: () => api.StartSelfUpdate(),     method: 'POST', path: '/api/v1/system/self-update' },
  { name: 'RestartToApply',      call: () => api.RestartToApply(),      method: 'POST', path: '/api/v1/system/self-update/restart' },
  { name: 'GetOWData',           call: () => api.GetOWData(),           method: 'GET',  path: '/api/v1/system/reference-data' },
]

const MATCH_READS: WireCase[] = [
  { name: 'GetIgnoredScreenshots', call: () => api.GetIgnoredScreenshots(), method: 'GET', path: '/api/v1/screenshots/ignored' },
  { name: 'GetFailedFiles',        call: () => api.GetFailedFiles(),        method: 'GET', path: '/api/v1/screenshots/failed' },
  { name: 'GetActiveParse',        call: () => api.GetActiveParse(),        method: 'GET', path: '/api/v1/parses/active' },
]

const MATCH_WRITES: WireCase[] = [
  { name: 'DeleteMatchAnnotation', call: () => api.DeleteMatchAnnotation(KEY), method: 'DELETE', path: `/api/v1/matches/${KEY}/annotation` },
  { name: 'HardDeleteMatch',       call: () => api.HardDeleteMatch(KEY),       method: 'DELETE', path: `/api/v1/matches/${KEY}` },
  { name: 'ResetMatchData',        call: () => api.ResetMatchData(KEY),        method: 'DELETE', path: `/api/v1/matches/${KEY}/data` },
  {
    name: 'CreateManualMatch', method: 'POST', path: '/api/v1/matches',
    call: () => api.CreateManualMatch({ map: 'rialto', result: 'victory' }),
    body: { map: 'rialto', result: 'victory' },
  },
  {
    name: 'UpdateMatchData', method: 'PUT', path: `/api/v1/matches/${KEY}/data`,
    call: () => api.UpdateMatchData(KEY, { map: 'rialto' }),
    body: { map: 'rialto' },
  },
  {
    name: 'SetMatchPin', method: 'PUT', path: `/api/v1/matches/${KEY}/pin`,
    call: () => api.SetMatchPin(KEY, true), body: { pinned: true },
  },
  {
    name: 'SetMatchVisibility', method: 'PUT', path: `/api/v1/matches/${KEY}/visibility`,
    call: () => api.SetMatchVisibility(KEY, true), body: { hidden: true },
  },
  {
    name: 'ResolveAmbiguousMatch', method: 'PUT', path: '/api/v1/matches/ambiguous-abc/resolution',
    call: () => api.ResolveAmbiguousMatch('ambiguous-abc', KEY), body: { resolved_to: KEY },
  },
  {
    name: 'MoveMatches', method: 'POST', path: '/api/v1/matches/transfers',
    call: () => api.MoveMatches([KEY], 'alt'), body: { match_keys: [KEY], target_profile: 'alt' },
  },
]

// The '' sentinel clears a per-match tag with a DELETE; any other value
// upserts with a PUT. Both directions matter — a DELETE spelled as a PUT
// would write the empty string as a real override.
const TAG_TOGGLES: WireCase[] = [
  {
    name: "SetMatchQueue('open') upserts", method: 'PUT', path: `/api/v1/matches/${KEY}/queue`,
    call: () => api.SetMatchQueue(KEY, 'open'), body: { queue_type: 'open' },
  },
  { name: "SetMatchQueue('') clears", call: () => api.SetMatchQueue(KEY, ''), method: 'DELETE', path: `/api/v1/matches/${KEY}/queue` },
  {
    name: "SetMatchPlayMode('quickplay') upserts", method: 'PUT', path: `/api/v1/matches/${KEY}/play-mode`,
    call: () => api.SetMatchPlayMode(KEY, 'quickplay'), body: { play_mode: 'quickplay' },
  },
  { name: "SetMatchPlayMode('') clears", call: () => api.SetMatchPlayMode(KEY, ''), method: 'DELETE', path: `/api/v1/matches/${KEY}/play-mode` },
  {
    name: 'BulkSetMatchQueue', method: 'PUT', path: '/api/v1/matches/queue',
    call: () => api.BulkSetMatchQueue([KEY], ''), body: { match_keys: [KEY], queue_type: '' },
  },
  {
    name: 'BulkSetMatchPlayMode', method: 'PUT', path: '/api/v1/matches/play-mode',
    call: () => api.BulkSetMatchPlayMode([KEY], 'competitive'), body: { match_keys: [KEY], play_mode: 'competitive' },
  },
]

const SCREENSHOTS: WireCase[] = [
  { name: 'UnignoreScreenshot',      call: () => api.UnignoreScreenshot('a b.png'), method: 'DELETE', path: '/api/v1/screenshots/a%20b.png/ignore' },
  { name: 'ClearIgnoredScreenshots', call: () => api.ClearIgnoredScreenshots(),     method: 'DELETE', path: '/api/v1/screenshots/ignored' },
  { name: 'CancelParse',             call: () => api.CancelParse(),                 method: 'DELETE', path: '/api/v1/parses/active' },
]

const SETTINGS: WireCase[] = [
  { name: 'GetScreenshotsDir',   call: () => api.GetScreenshotsDir(),   method: 'GET',    path: '/api/v1/settings/screenshots-folder' },
  { name: 'ResetScreenshotsDir', call: () => api.ResetScreenshotsDir(), method: 'DELETE', path: '/api/v1/settings/screenshots-folder' },
  {
    name: 'SetScreenshotsDir', method: 'PUT', path: '/api/v1/settings/screenshots-folder',
    call: () => api.SetScreenshotsDir('D:\\shots'), body: { path: 'D:\\shots' },
  },
  { name: 'RevealScreenshotsDir',              call: () => api.RevealScreenshotsDir(),              method: 'POST', path: '/api/v1/system/screenshots-folder-reveal' },
  { name: 'GetScreenshotsFolderCandidates',    call: () => api.GetScreenshotsFolderCandidates(),    method: 'GET',  path: '/api/v1/system/screenshots-folder-candidates' },
  { name: 'GetScreenshotsFolderCandidateStats', call: () => api.GetScreenshotsFolderCandidateStats(), method: 'GET', path: '/api/v1/system/screenshots-folder-candidates/stats' },
  { name: 'GetWatchEnabled',  call: () => api.GetWatchEnabled(),  method: 'GET', path: '/api/v1/settings/watcher' },
  { name: 'GetExitOnClose',   call: () => api.GetExitOnClose(),   method: 'GET', path: '/api/v1/settings/close-behavior' },
  {
    name: 'SetExitOnClose', method: 'PUT', path: '/api/v1/settings/close-behavior',
    call: () => api.SetExitOnClose(true), body: { exit_on_close: true },
  },
  { name: 'GetTesseractStatus',   call: () => api.GetTesseractStatus(),   method: 'GET',    path: '/api/v1/settings/tesseract' },
  { name: 'ResetTesseractPath',   call: () => api.ResetTesseractPath(),   method: 'DELETE', path: '/api/v1/settings/tesseract' },
  {
    name: 'SetTesseractPath', method: 'PUT', path: '/api/v1/settings/tesseract',
    call: () => api.SetTesseractPath('/usr/bin/tesseract'), body: { path: '/usr/bin/tesseract' },
  },
  { name: 'ProbeTesseractBinary', call: () => api.ProbeTesseractBinary(), method: 'GET', path: '/api/v1/system/tesseract-probe' },
  { name: 'GetAutoBackupStatus',  call: () => api.GetAutoBackupStatus(),  method: 'GET', path: '/api/v1/settings/auto-backup' },
  {
    name: 'SetAutoBackupInterval', method: 'PUT', path: '/api/v1/settings/auto-backup',
    call: () => api.SetAutoBackupInterval(7), body: { interval_days: 7 },
  },
]

const PROFILES: WireCase[] = [
  { name: 'GetProfiles',     call: () => api.GetProfiles(),        method: 'GET',    path: '/api/v1/profiles' },
  { name: 'SeedTestProfile', call: () => api.SeedTestProfile(),    method: 'POST',   path: '/api/v1/profiles/test/seed' },
  { name: 'DeleteProfile',   call: () => api.DeleteProfile('alt'), method: 'DELETE', path: '/api/v1/profiles/alt' },
  {
    name: 'CreateProfile', method: 'POST', path: '/api/v1/profiles',
    call: () => api.CreateProfile('alt'), body: { name: 'alt' },
  },
  {
    name: 'SwitchProfile', method: 'PUT', path: '/api/v1/profiles/active',
    call: () => api.SwitchProfile('alt'), body: { name: 'alt' },
  },
  {
    name: 'RenameProfile', method: 'PUT', path: '/api/v1/profiles/old',
    call: () => api.RenameProfile('old', 'new'), body: { new_name: 'new' },
  },
]

// The coaching surface. The session is a server-side STATE, so its verbs
// carry the lifecycle: POST opens (binary, so it lives on the platform
// seam), GET reads, DELETE ends. Per-match notes follow the same
// PUT-upserts / DELETE-clears rule as the other per-match sub-resources —
// an emptied draft must DELETE the row, never PUT an empty note.
const COACH: WireCase[] = [
  { name: 'GetCoachSession',        call: () => api.GetCoachSession(),        method: 'GET',    path: '/api/v1/coach/session' },
  { name: 'CloseCoachSession',      call: () => api.CloseCoachSession(),      method: 'DELETE', path: '/api/v1/coach/session' },
  { name: 'GetCoachSessionMatches', call: () => api.GetCoachSessionMatches(), method: 'GET',    path: '/api/v1/coach/session/matches' },
  {
    name: 'SetCoachSessionPlayer', method: 'PUT', path: '/api/v1/coach/session/player',
    call: () => api.SetCoachSessionPlayer('Sable'), body: { handle: 'Sable', kind: 'player' },
  },
  {
    name: 'PutCoachNote', method: 'PUT', path: `/api/v1/coach/session/notes/${KEY}`,
    call: () => api.PutCoachNote(KEY, {
      kind: 'note', text: 'Peel earlier.', focus_tags: ['positioning'], extra_tags: [], match_clock: '04:12',
    }),
    body: { kind: 'note', text: 'Peel earlier.', focus_tags: ['positioning'], extra_tags: [], match_clock: '04:12' },
  },
  { name: 'DeleteCoachNote', call: () => api.DeleteCoachNote(KEY), method: 'DELETE', path: `/api/v1/coach/session/notes/${KEY}` },
  {
    name: 'PutCoachFocusItems', method: 'PUT', path: '/api/v1/coach/session/focus-items',
    call: () => api.PutCoachFocusItems([{ item_id: 'c7d8e9f0-1a2b-4c3d-8e4f-5a6b7c8d9e0f', text: 'Ult economy first.' }]),
    body: { items: [{ item_id: 'c7d8e9f0-1a2b-4c3d-8e4f-5a6b7c8d9e0f', text: 'Ult economy first.' }] },
  },
  { name: 'ListFocus', call: () => api.ListFocus(), method: 'GET', path: '/api/v1/focus' },
  {
    name: 'SetFocusItemStatus', method: 'PUT', path: '/api/v1/focus/f-1/status',
    call: () => api.SetFocusItemStatus('f-1', 'working'), body: { status: 'working' },
  },
  { name: 'ListCoachReturns',  call: () => api.ListCoachReturns(),   method: 'GET',    path: '/api/v1/coach/returns' },
  { name: 'GetCoachReturn',    call: () => api.GetCoachReturn(7),    method: 'GET',    path: '/api/v1/coach/returns/7' },
  { name: 'DeleteCoachReturn', call: () => api.DeleteCoachReturn(7), method: 'DELETE', path: '/api/v1/coach/returns/7' },
  {
    name: 'DecideCoachReturn', method: 'PUT', path: '/api/v1/coach/returns/7/decisions',
    call: () => api.DecideCoachReturn(7, { 'note-1': 'accepted', 'note-2': 'skipped' }),
    body: { decisions: { 'note-1': 'accepted', 'note-2': 'skipped' } },
  },
  { name: 'DeleteMatchCoachNote', call: () => api.DeleteMatchCoachNote(KEY, 3), method: 'DELETE', path: `/api/v1/matches/${KEY}/coach-notes/3` },
  { name: 'GetCoachingSettings', call: () => api.GetCoachingSettings(), method: 'GET', path: '/api/v1/settings/coaching' },
  {
    name: 'SetCoachingSettings', method: 'PUT', path: '/api/v1/settings/coaching',
    call: () => api.SetCoachingSettings({ coach_name: 'Ordo', player_handle: 'Sable' }),
    body: { coach_name: 'Ordo', player_handle: 'Sable' },
  },
]

const DATABASE: WireCase[] = [
  { name: 'GetDatabaseHealth', call: () => api.GetDatabaseHealth(), method: 'GET', path: '/api/v1/database/health' },
  {
    name: 'RunDatabaseMaintenance', method: 'POST', path: '/api/v1/database/maintenance',
    call: () => api.RunDatabaseMaintenance('vacuum'), body: { operation: 'vacuum' },
  },
]

function pinsWire(cases: WireCase[]) {
  it.each(cases)('$name', async ({ call, method, path, search, body }: WireCase) => {
    const spy = stubFetch()
    await call()
    const req = lastRequest(spy)
    const url = new URL(req.url)
    expect([req.method, url.pathname, url.search]).toEqual([method, path, search ?? ''])
    if (body !== undefined) expect(JSON.parse(await req.text())).toEqual(body)
  })
}

describe('api facade → wire contract', () => {
  describe('system + update', () => { pinsWire(SYSTEM) })
  describe('match reads', () => { pinsWire(MATCH_READS) })
  describe('match writes', () => { pinsWire(MATCH_WRITES) })
  describe('per-match tag toggles (PUT upserts, "" clears via DELETE)', () => { pinsWire(TAG_TOGGLES) })
  describe('screenshots + parse', () => { pinsWire(SCREENSHOTS) })
  describe('settings', () => { pinsWire(SETTINGS) })
  describe('profiles', () => { pinsWire(PROFILES) })
  describe('coaching', () => { pinsWire(COACH) })
  describe('database', () => { pinsWire(DATABASE) })
})
