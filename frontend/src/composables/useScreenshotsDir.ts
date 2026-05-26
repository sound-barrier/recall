import { ref, type Ref } from 'vue'

// Screenshots directory: the persisted path plus the two ways to
// change it — native folder picker (PickScreenshotsDir) and
// platform-probe auto-detect (ProbeScreenshotsDir + SetScreenshotsDir).
//
// Extracted from App.vue so the watch-armed confirm prompt + probe
// state machine can be tested without mounting. The composable
// doesn't know about `watchEnabled` directly — it asks the caller
// via `shouldConfirmPickWhile()` which returns a bool (or its async
// equivalent) — so the test suite can drive both branches.

export type ProbeStatus = '' | 'success' | 'blocked'

export interface ProbeResult {
  found: boolean
  path?: string
  tried?: string[]
}

export interface ScreenshotsDirApi {
  pickScreenshotsDir: () => Promise<string | undefined>
  probeScreenshotsDir: () => Promise<ProbeResult>
  setScreenshotsDir: (path: string) => Promise<unknown>
  // Called after a successful pick/detect so the "N new" counter
  // can re-roll against the new directory.
  refreshNewCount?: () => Promise<void> | void
  // Returns true when the caller wants the user to confirm before
  // re-targeting the watcher. Synchronous because window.confirm is.
  // Default: always allow the pick (no confirm UI).
  shouldConfirmPickWhile?: () => boolean
  onError?: (message: string) => void
}

export function useScreenshotsDir(api: ScreenshotsDirApi) {
  const screenshotsDir = ref('')

  // Probe state — mirrors into SettingsView's "Detect Overwatch
  // Folder" button. `probeStatus` is split from `probeMessage` so
  // the chip styling (accent vs muted) doesn't depend on string
  // parsing.
  const probing      = ref(false)
  const probeMessage = ref('')
  const probeStatus  = ref<ProbeStatus>('')
  const probeTried   = ref<string[]>([])

  function setScreenshotsDir(next: string) {
    screenshotsDir.value = next
  }

  async function pickDir() {
    if (api.shouldConfirmPickWhile?.()) {
      // Caller's responsibility to actually surface the confirm UI
      // (window.confirm in production); if the predicate returns
      // true and the caller wants to abort, they return early.
      // Default callers don't set this hook → no prompt → always
      // proceed.
      const ok = window.confirm(
        'Watch Folder is currently armed.\n\n' +
        'Switching the screenshots folder will re-target the watcher to the new directory. ' +
        'Continue?',
      )
      if (!ok) return
    }
    try {
      const dir = await api.pickScreenshotsDir()
      if (dir) screenshotsDir.value = dir
      await api.refreshNewCount?.()
    } catch (e) {
      api.onError?.(String(e))
    }
  }

  async function detectDir() {
    probing.value = true
    probeMessage.value = ''
    probeStatus.value = ''
    probeTried.value = []
    try {
      const res = await api.probeScreenshotsDir()
      probeTried.value = res.tried || []
      if (res.found && res.path) {
        await api.setScreenshotsDir(res.path)
        screenshotsDir.value = res.path
        probeStatus.value = 'success'
        probeMessage.value = `Detected · ${res.path}`
        await api.refreshNewCount?.()
      } else {
        probeStatus.value = 'blocked'
        probeMessage.value = 'No default Overwatch folder on this machine. Use Change Folder… to point at it.'
      }
    } catch (e) {
      probeStatus.value = 'blocked'
      probeMessage.value = `Detect failed: ${String(e)}`
    } finally {
      probing.value = false
    }
  }

  return {
    screenshotsDir: screenshotsDir as Readonly<Ref<string>>,
    probing,
    probeMessage,
    probeStatus,
    probeTried,
    setScreenshotsDir,
    pickDir,
    detectDir,
  }
}
