import { ApiError } from '@/api-error'

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
// phase. 'refused' is a release Recall would not install because it could
// not be verified; the dialog explains that itself, so `error` stays empty.
type SelfUpdatePhase =
  | 'idle' | 'starting' | 'downloading' | 'verifying'
  | 'installing' | 'ready' | 'restarting' | 'error' | 'refused'

export interface SelfUpdateState {
  phase: SelfUpdatePhase
  pct: number | null
  error: string
}

// The text of errUpdateRefused in pkg/cmd/selfupdate.go, the sentinel every
// refusal of a release wraps. Wails flattens the Go error into the
// wails:updater:error message with its own prefixes in front, so only the
// text reaches the page and it is matched anywhere in the message. Keep it
// in lockstep with the Go sentinel, like the event names above.
export const UPDATE_REFUSAL_TOKEN = 'update refused'

// The problem types of the two 409s the server answers while an update is
// staged (pkg/cmd/problems.go): a start over the staged binary, and a
// restart with nothing staged. Matched on the type, never the text.
export const SELF_UPDATE_STAGED_PROBLEM = 'https://github.com/sound-barrier/recall/problems/self-update-staged'
export const SELF_UPDATE_NOT_READY_PROBLEM = 'https://github.com/sound-barrier/recall/problems/self-update-not-ready'

/** Whether a rejected request answered with this problem type. */
export function isProblem(e: unknown, type: string): boolean {
  return e instanceof ApiError && e.problem?.type === type
}

/** Tells a release Recall refused to install from an update that failed. */
export function updaterErrorPhase(message: string | undefined): Extract<SelfUpdatePhase, 'error' | 'refused'> {
  return message?.includes(UPDATE_REFUSAL_TOKEN) ? 'refused' : 'error'
}

// ── The phase machine ────────────────────────────────────────────────
// The updater's events carry nothing that names a run, so a stale event is
// told apart by where it would move the phase: a progress tick after the run
// failed, or after the update was staged, is a move no live run makes, and it
// is refused. The client's own requests ride the same function, which is what
// stops a second start over a running pass — or over a staged binary it would
// throw away.

export type SelfUpdateEvent =
  | { type: 'start-requested' }
  | { type: 'start-rejected'; error: string }
  /** The server refused the start because an update is already staged. */
  | { type: 'found-staged' }
  | { type: 'check-started' }
  | { type: 'no-update' }
  | { type: 'download-started' }
  | { type: 'download-progress'; pct: number | null }
  | { type: 'verifying' }
  | { type: 'installing' }
  | { type: 'ready' }
  | { type: 'failed'; phase: 'error' | 'refused'; error: string }
  | { type: 'restart-requested' }
  /** `staged`: the update is still staged, so Restart stays on offer. */
  | { type: 'restart-failed'; error: string; staged: boolean }

const IN_FLIGHT: readonly SelfUpdatePhase[] = ['starting', 'downloading', 'verifying', 'installing']
const SETTLED: readonly SelfUpdatePhase[] = ['idle', 'error', 'refused']

// The phases each event may arrive in.
const LEGAL_FROM: Record<SelfUpdateEvent['type'], readonly SelfUpdatePhase[]> = {
  'start-requested':   SETTLED,
  'start-rejected':    ['starting'],
  'found-staged':      ['starting'],
  'check-started':     [...SETTLED, 'starting'],
  'no-update':         ['starting'],
  'download-started':  ['starting', 'downloading'],
  'download-progress': ['starting', 'downloading'],
  'verifying':         ['starting', 'downloading', 'verifying'],
  'installing':        ['downloading', 'verifying', 'installing'],
  'ready':             ['verifying', 'installing'],
  'failed':            IN_FLIGHT,
  'restart-requested': ['ready'],
  'restart-failed':    ['restarting'],
}

const state = (phase: SelfUpdatePhase, pct: number | null = null, error = ''): SelfUpdateState => ({ phase, pct, error })

type Moves = { [K in SelfUpdateEvent['type']]: (event: Extract<SelfUpdateEvent, { type: K }>, current: SelfUpdateState) => SelfUpdateState }

// Where each event moves the phase, once LEGAL_FROM has let it in.
const MOVES: Moves = {
  'start-requested':   () => state('starting'),
  'check-started':     () => state('starting'),
  'no-update':         () => state('idle'),
  'download-started':  () => state('downloading'),
  'download-progress': (event) => state('downloading', event.pct),
  'verifying':         () => state('verifying', 100),
  'installing':        () => state('installing', 100),
  'ready':             () => state('ready', 100),
  'restart-requested': (_event, current) => ({ ...current, phase: 'restarting', error: '' }),
  'failed':            (event) => state(event.phase, null, event.error),
  'start-rejected':    (event) => state('error', null, event.error),
  'found-staged':      () => state('ready', 100),
  'restart-failed':    (event) => (event.staged ? state('ready', 100, event.error) : state('error', null, event.error)),
}

/** The one transition function: the next state, or null for a move no run makes. */
export function stepSelfUpdate(current: SelfUpdateState, event: SelfUpdateEvent): SelfUpdateState | null {
  if (!LEGAL_FROM[event.type].includes(current.phase)) return null
  // TypeScript cannot correlate an indexed handler with the event that
  // picked it; the map's mapped type is what guarantees the pairing.
  const move = MOVES[event.type] as (event: SelfUpdateEvent, current: SelfUpdateState) => SelfUpdateState
  return move(event, current)
}
