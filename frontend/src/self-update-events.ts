// Wire-string constants for the Wails v3 updater's host→page events.
//
// The pinned @wailsio/runtime (3.0.0-alpha.79) ships no Updater.Events
// export, so we carry the strings here. Keep them in lockstep with
// github.com/wailsapp/wails/v3/pkg/updater/events.go (the Go side emits
// them via app.Event.Emit; api.ts's EventsOn bridge delivers them,
// unwrapping the `.data` payload). Only the subscribe-side (host→page)
// events the About dialog observes are listed.
export const SelfUpdateEvents = {
  CheckStarted:     'wails:updater:check-started',
  UpdateAvailable:  'wails:updater:update-available',
  NoUpdate:         'wails:updater:no-update',
  DownloadStarted:  'wails:updater:download-started',
  DownloadProgress: 'wails:updater:download-progress',
  DownloadComplete: 'wails:updater:download-complete',
  Verifying:        'wails:updater:verifying',
  Installing:       'wails:updater:installing',
  UpdateReady:      'wails:updater:update-ready',
  Error:            'wails:updater:error',
} as const

// Payloads (subset of fields the UI reads; lowercase json tags from the
// Go structs updater.Progress / updater.ErrorInfo).
export interface SelfUpdateProgress {
  written: number
  total: number
  rate: number
}

export interface SelfUpdateError {
  stage: string
  message: string
}

// The About dialog's self-update lifecycle, owned by the app store and
// passed to AboutModal. `pct` is null while indeterminate (no total
// received yet); `error` carries a user-facing message in the 'error'
// phase.
export type SelfUpdatePhase =
  | 'idle' | 'starting' | 'downloading' | 'verifying'
  | 'installing' | 'ready' | 'restarting' | 'error'

export interface SelfUpdateState {
  phase: SelfUpdatePhase
  pct: number | null
  error: string
}
