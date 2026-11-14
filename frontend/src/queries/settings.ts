import { useQuery } from '@tanstack/vue-query'

import {
  GetAutoBackupStatus,
  GetCoachingSettings,
  GetExitOnClose,
  GetScreenshotsDir,
  GetScreenshotsFolderCandidates,
  GetTesseractStatus,
  GetWatchEnabled,
  GetWatchState,
  SetCoachingSettings,
  type CoachingSettings,
  type NamedCandidate,
  type TesseractStatus,
} from '@/api-client'
import { getQueryClient } from '@/queries/client'
import { qk } from '@/queries/keys'

export function useScreenshotsDirQuery() {
  return useQuery({ queryKey: qk.settings.screenshotsDir, queryFn: GetScreenshotsDir }, getQueryClient())
}

export function useWatchEnabledQuery() {
  return useQuery({ queryKey: qk.settings.watch, queryFn: GetWatchEnabled }, getQueryClient())
}

// What the watcher is doing — seeded by this read, then kept current by the
// `watch-state` event writing into the same cache entry (useServerEvents).
export function useWatchStateQuery() {
  return useQuery({ queryKey: qk.settings.watchState, queryFn: GetWatchState }, getQueryClient())
}

export function useExitOnCloseQuery() {
  return useQuery({ queryKey: qk.settings.exitOnClose, queryFn: GetExitOnClose }, getQueryClient())
}

// A failed probe is a real "not detected" state, not a query error — the
// Engine section renders the error string, so the queryFn never throws.
async function fetchTesseractStatus(): Promise<TesseractStatus> {
  try {
    return await GetTesseractStatus()
  } catch (e) {
    return { state: 'unavailable', path: '', found: false, version: '', supported: false, error: String(e), default: '', platform: '' }
  }
}

export function useTesseractQuery() {
  return useQuery({ queryKey: qk.settings.tesseract, queryFn: fetchTesseractStatus }, getQueryClient())
}

// The boot-time engine probe reports once, as an event, and events are not
// replayed. A read that answered "probing" may predate a listener that was
// not yet attached when the probe's answer went out — so once the listeners
// are up, wait for that first read and, if it is still "probing", read again.
// (A refetch issued while the first read is in flight would only join it.)
export async function recheckTesseractWhileProbing(): Promise<void> {
  const qc = getQueryClient()
  const first = await qc.ensureQueryData({ queryKey: qk.settings.tesseract, queryFn: fetchTesseractStatus })
  if (first.state === 'probing') await qc.refetchQueries({ queryKey: qk.settings.tesseract })
}

export function useAutoBackupQuery() {
  return useQuery({ queryKey: qk.settings.autoBackup, queryFn: GetAutoBackupStatus }, getQueryClient())
}

// Best-effort hint for the empty-state + first-run pickers — a failure
// falls back to an empty list so the manual "Choose folder…" path still
// shows; nothing here is user-blocking.
export function useCandidatesQuery() {
  return useQuery({
    queryKey: qk.candidates,
    queryFn: async (): Promise<NamedCandidate[]> => {
      try {
        return await GetScreenshotsFolderCandidates()
      } catch (_) {
        return []
      }
    },
  }, getQueryClient())
}

// The coach name and player handle — server settings, not browser preferences:
// the exported ledger is rendered server-side and needs the name, and the
// handle is stamped into a shared bundle's manifest.
//
// These were the app's ONLY server read outside the cache (TECHNICAL_DEBT.md
// section 16). Two components fetched them straight from the api seam, so
// SetCoachingSettings had no key to invalidate and the two surfaces agreed
// only because the share dialog happened to re-fetch every time it opened.
export function useCoachingSettingsQuery() {
  return useQuery({
    queryKey: qk.settings.coaching,
    queryFn: GetCoachingSettings,
    meta: { banner: 'Could not load coaching settings' },
  }, getQueryClient())
}

export async function setCoachingSettings(next: CoachingSettings): Promise<CoachingSettings> {
  const saved = await SetCoachingSettings(next)
  await getQueryClient().invalidateQueries({ queryKey: qk.settings.coaching })
  return saved
}
