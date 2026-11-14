import { useQuery, type QueryKey } from '@tanstack/vue-query'
import { computed, type WritableComputedRef } from 'vue'

import {
  GetAutoBackupStatus,
  GetCoachingSettings,
  GetExitOnClose,
  GetScreenshotsDir,
  GetScreenshotsFolderCandidates,
  GetScreenshotsFolderCandidateStats,
  GetTesseractStatus,
  GetWatcherStatus,
  SetCoachingSettings,
  type CoachingSettings,
  type NamedCandidate,
  type NamedCandidateStats,
  type TesseractStatus,
  type WatchStateEnum,
  type WatcherStatus,
} from '@/api-client'
import { getQueryClient } from '@/queries/client'
import { qk } from '@/queries/keys'

// ── Writes land in the cache ─────────────────────────────────────────
// A setting the user changes is written straight into its cache entry — the
// cache IS the store's state, there is no copy to keep in step. Each write
// bumps the key's generation, and a read started before the write answers
// with the cache as it now stands instead of its own (older) value: the boot
// GET of the Watch flag landing after the user flipped it used to flip it
// back on screen while the server held the new value.
const writeGenerations = new Map<string, number>()
const generationOf = (key: QueryKey) => writeGenerations.get(JSON.stringify(key)) ?? 0

/** Put a value the server has just accepted (or announced) into the cache. */
export function writeSetting<T>(key: QueryKey, value: T): void {
  writeGenerations.set(JSON.stringify(key), generationOf(key) + 1)
  getQueryClient().setQueryData(key, value)
}

function readUnlessWritten<T>(key: QueryKey, read: () => Promise<T>): () => Promise<T> {
  return async () => {
    const asked = generationOf(key)
    const value = await read()
    if (asked === generationOf(key)) return value
    return getQueryClient().getQueryData<T>(key) ?? value
  }
}

/** The cache entry as a ref: reads the query, writes through writeSetting. */
export function settingRef<T>(key: QueryKey, data: () => T | undefined, fallback: T): WritableComputedRef<T> {
  return computed<T>({
    get: () => data() ?? fallback,
    set: (next) => { writeSetting(key, next) },
  })
}

export function useScreenshotsDirQuery() {
  return useQuery({
    queryKey: qk.settings.screenshotsDir,
    queryFn: readUnlessWritten(qk.settings.screenshotsDir, GetScreenshotsDir),
  }, getQueryClient())
}

// The Watch setting and the watcher's state, as one cache entry: Settings'
// toggle reads `enabled`, the masthead dot reads `watch_state`. A toggle
// writes `enabled` (and `off` when it turns Watch off); the `watch-state`
// event writes the state. Both go through writeSetting, so a boot read still
// in flight cannot paint over either.
export function useWatcherQuery() {
  return useQuery({
    queryKey: qk.settings.watch,
    queryFn: readUnlessWritten(qk.settings.watch, GetWatcherStatus),
  }, getQueryClient())
}

/** The `watch-state` event: what the watcher is doing now. */
export function applyWatchState(watchState: WatchStateEnum): void {
  // Before the first read answers there is no setting to keep; a watcher
  // that is running (or waiting on its folder) means Watch is on.
  const known = getQueryClient().getQueryData<WatcherStatus>(qk.settings.watch)
  writeSetting<WatcherStatus>(qk.settings.watch, { enabled: known?.enabled ?? watchState !== 'off', watch_state: watchState })
}


export function useExitOnCloseQuery() {
  return useQuery({
    queryKey: qk.settings.exitOnClose,
    queryFn: readUnlessWritten(qk.settings.exitOnClose, GetExitOnClose),
  }, getQueryClient())
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
  return useQuery({
    queryKey: qk.settings.tesseract,
    queryFn: readUnlessWritten(qk.settings.tesseract, fetchTesseractStatus),
  }, getQueryClient())
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

// The per-source diagnostics behind the picker cards (a bounded directory
// walk per source — seconds on a synced cloud folder, so it is fetched after
// the cards mount, never at boot). Enrichment only: a failure is an empty
// list, and the cards just skip their second line.
export function useCandidateStatsQuery() {
  return useQuery({
    queryKey: qk.candidateStats,
    queryFn: async (): Promise<NamedCandidateStats[]> => {
      try {
        return await GetScreenshotsFolderCandidateStats()
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
