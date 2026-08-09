import { useQuery } from '@tanstack/vue-query'

import {
  GetAutoBackupStatus,
  GetExitOnClose,
  GetScreenshotsDir,
  GetScreenshotsFolderCandidates,
  GetTesseractStatus,
  GetWatchEnabled,
  type NamedCandidate,
  type TesseractStatus,
} from '@/api-client'
import { queryClient } from '@/queries/client'
import { qk } from '@/queries/keys'

export function useScreenshotsDirQuery() {
  return useQuery({ queryKey: qk.settings.screenshotsDir, queryFn: GetScreenshotsDir }, queryClient)
}

export function useWatchEnabledQuery() {
  return useQuery({ queryKey: qk.settings.watch, queryFn: GetWatchEnabled }, queryClient)
}

export function useExitOnCloseQuery() {
  return useQuery({ queryKey: qk.settings.exitOnClose, queryFn: GetExitOnClose }, queryClient)
}

// A failed probe is a real "not detected" state, not a query error — the
// Engine section renders the error string, so the queryFn never throws.
export function useTesseractQuery() {
  return useQuery({
    queryKey: qk.settings.tesseract,
    queryFn: async (): Promise<TesseractStatus> => {
      try {
        return await GetTesseractStatus()
      } catch (e) {
        return { path: '', found: false, version: '', supported: false, error: String(e), default: '', platform: '' }
      }
    },
  }, queryClient)
}

export function useAutoBackupQuery() {
  return useQuery({ queryKey: qk.settings.autoBackup, queryFn: GetAutoBackupStatus }, queryClient)
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
  }, queryClient)
}
