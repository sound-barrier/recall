import { IS_WAILS, wailsCall } from '@/api-platform'
import { unwrap, unwrapVoid } from '@/api-unwrap'
import * as sdk from '@/client/sdk.gen'
import type { NamedCandidateStats } from '@/api/types'
import type {
  TesseractStatus,
  AutoBackupStatus,
  NamedCandidate,
  ProbeResult,
} from '@/client/types.gen'

// Re-exported wire types — consumers import these instead of reaching into
// the generated module directly.

// ─── Settings ──────────────────────────────────────────────────────────────

export function GetScreenshotsDir(): Promise<string> {
  return unwrap(sdk.getScreenshotsFolder()).then(d => d.path)
}

// Desktop: native folder picker (falls back to the existing value on
// cancel). Server mode: prompt for a path and PUT it.
export async function PickScreenshotsDir(): Promise<string> {
  if (IS_WAILS) return wailsCall('PickScreenshotsDir')
  const current = await GetScreenshotsDir()
  const p = window.prompt('Screenshots directory path:', current)
  if (!p) return current
  await SetScreenshotsDir(p)
  return p
}

// GetScreenshotsFolderCandidates returns the per-source picker list
// (empty on non-Windows — auto-detect is Windows-only by design).
export function GetScreenshotsFolderCandidates(): Promise<NamedCandidate[]> {
  return unwrap(sdk.getScreenshotsFolderCandidates())
}

// The deferred per-source diagnostics call. The picker grid fetches this
// after the cards mount so the directory walk (bounded to 1000 entries
// per source) doesn't block the visible UI.
export function GetScreenshotsFolderCandidateStats(): Promise<NamedCandidateStats[]> {
  return unwrap(sdk.getScreenshotsFolderCandidateStats())
}

// SetScreenshotsDir persists `path` as the active screenshots directory.
// Used by the "Detect Overwatch Folder" button to apply a probe result
// without going through the native folder picker.
export function SetScreenshotsDir(path: string): Promise<void> {
  return unwrapVoid(sdk.setScreenshotsFolder({ body: { path } }))
}

// ResetScreenshotsDir clears the persisted screenshots folder and tears
// down the watcher. Symmetric with ResetTesseractPath.
export function ResetScreenshotsDir(): Promise<void> {
  return unwrapVoid(sdk.resetScreenshotsFolder())
}

// RevealScreenshotsDir opens the configured folder in the host OS file
// manager. No path argument: the configured folder is the only thing this
// action reveals, so passing an arbitrary path would widen attack surface.
export function RevealScreenshotsDir(): Promise<void> {
  return unwrapVoid(sdk.revealScreenshotsFolder())
}

export function GetWatchEnabled(): Promise<boolean> {
  return unwrap(sdk.getWatchEnabled()).then(d => d.enabled)
}

export function SetWatchEnabled(enabled: boolean): Promise<void> {
  return unwrapVoid(sdk.setWatchEnabled({ body: { enabled } }))
}

export function GetExitOnClose(): Promise<boolean> {
  return unwrap(sdk.getExitOnClose()).then(d => d.exit_on_close)
}

export function SetExitOnClose(exitOnClose: boolean): Promise<void> {
  return unwrapVoid(sdk.setExitOnClose({ body: { exit_on_close: exitOnClose } }))
}

export function GetTesseractStatus(): Promise<TesseractStatus> {
  return unwrap(sdk.getTesseractSettings())
}

// Desktop: native file picker. Server mode: prompt for the binary path
// then PUT it, echoing the re-detected status.
export async function PickTesseractBinary(): Promise<TesseractStatus> {
  if (IS_WAILS) return wailsCall('PickTesseractBinary')
  const current = await GetTesseractStatus().then(d => d.path || '')
  const p = window.prompt('Path to Tesseract binary:', current)
  if (!p) return GetTesseractStatus()
  return SetTesseractPath(p)
}

// Reset to the platform default — modeled server-side as DELETE on the
// tesseract setting (the user-set override is the thing being deleted).
// Returns the re-detected status.
export function ResetTesseractPath(): Promise<TesseractStatus> {
  return unwrap(sdk.resetTesseractPath())
}

// ProbeTesseractBinary walks per-OS install locations + PATH and returns
// the first that resolves to a working Tesseract 5.x. Read-only — the
// caller (Detect button) decides whether to apply via SetTesseractPath.
export function ProbeTesseractBinary(): Promise<ProbeResult> {
  return unwrap(sdk.probeTesseractBinary())
}

// SetTesseractPath applies a known path (from the picker or the Detect
// probe) and returns the re-detected status.
export function SetTesseractPath(path: string): Promise<TesseractStatus> {
  return unwrap(sdk.setTesseractPath({ body: { path } }))
}

export function GetAutoBackupStatus(): Promise<AutoBackupStatus> {
  return unwrap(sdk.getAutoBackupStatus())
}

export function SetAutoBackupInterval(intervalDays: number): Promise<AutoBackupStatus> {
  return unwrap(sdk.setAutoBackupInterval({ body: { interval_days: intervalDays } }))
}
