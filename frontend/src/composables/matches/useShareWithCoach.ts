import { computed, ref, type Ref } from 'vue'

import { ExportBundle } from '@/api-client'
import type { MatchRecord } from '@/api'
import {
  missingReplayRows, shareManifestRows, shareSummaryLine,
  type ShareManifestRow,
} from '@/match/reviews/share-manifest'
import { invalidateShareExports } from '@/queries/selfReview'

// Sending matches to a coach — the outbound leg of the review cycle.
//
// This used to be a checkbox inside the backup dialog. It is its own verb
// now, with four front doors, and the one rule that makes four front doors
// safe lives here: EVERY caller passes explicit keys, and NOTHING downstream
// of those keys is re-derived by the caller. The manifest, the gaps, the
// subject line and the submit are all computed once, in one place.
//
// Sibling of useExportBundle, deliberately: same injected error/receipt
// surface, same host (the matches store), same shape.

/** How the set going out was chosen — the dialog says so out loud. */
export type ShareOrigin = 'row' | 'selection' | 'narrow' | 'last-session'

export interface ShareSubmission {
  handle: string
  message: string
  filename: string
}

export interface ShareWithCoachDeps {
  /** The records the keys are resolved against. */
  records: Ref<MatchRecord[]>
  onError: (raw: string) => void
  /** Where the written file landed, for the receipt strip. */
  onSaved: (message: string) => void
  /** Put the code-less matches on screen so they can be fixed. */
  showMatches: (keys: string[], why: string) => Promise<unknown> | void
}

const SUBJECT: Record<ShareOrigin, (n: number) => string> = {
  row: () => 'This match',
  selection: (n) => `${n} match${n === 1 ? '' : 'es'} you ticked`,
  narrow: (n) => `${n} match${n === 1 ? '' : 'es'} — everything showing on Matches`,
  'last-session': (n) => `Your last session — ${n} match${n === 1 ? '' : 'es'}`,
}

export function useShareWithCoach(deps: ShareWithCoachDeps) {
  const shareOpen = ref(false)
  const shareKeys = ref<string[]>([])
  const shareOrigin = ref<ShareOrigin>('selection')
  const shareBusy = ref(false)

  const shareManifest = computed<ShareManifestRow[]>(
    () => shareManifestRows(shareKeys.value, deps.records.value))
  const shareMissing = computed(() => missingReplayRows(shareManifest.value))
  const shareSummary = computed(() => shareSummaryLine(shareManifest.value))
  const shareSubject = computed(() => SUBJECT[shareOrigin.value](shareKeys.value.length))

  // Why the send is refused, or undefined when it is ready. The dialog puts
  // this on the disabled button; the manifest already says WHICH matches.
  const shareBlocked = computed<string | undefined>(() => {
    if (shareKeys.value.length === 0) return 'Nothing selected to send.'
    const missing = shareMissing.value.length
    if (missing > 0) {
      return `${missing} of these ${missing === 1 ? 'has' : 'have'} no replay code — `
        + 'a coach cannot load a match without one.'
    }
    return undefined
  })

  /**
   * Open the dialog over an explicit set. Callers pass keys; they never pass
   * a rule for finding keys — that is what kept four entry points from each
   * growing their own copy of the replay-code logic.
   */
  function requestShare(matchKeys: readonly string[], origin: ShareOrigin): void {
    shareKeys.value = [...matchKeys]
    shareOrigin.value = origin
    shareOpen.value = true
  }

  function closeShare(): void {
    shareOpen.value = false
  }

  /** Put the blockers on screen, and get out of the way. */
  async function showMissingOnMatches(): Promise<void> {
    const keys = shareMissing.value.map((row) => row.matchKey)
    shareOpen.value = false
    await deps.showMatches(keys, 'matches missing a replay code')
  }

  async function confirmShare(submission: ShareSubmission): Promise<void> {
    shareBusy.value = true
    try {
      const saved = await ExportBundle({
        matchKeys: shareKeys.value,
        // Never a toggle. Hidden matches were hidden on purpose and an
        // unknown-map match is unusable to a coach — and the server's replay
        // gate only validates the explicit keys, so a toggled-in extra would
        // slip past it entirely.
        includeHidden: false,
        includeUnknown: false,
        filename: submission.filename,
        share: { handle: submission.handle, message: submission.message },
      })
      // '' means the native save dialog was dismissed: nothing was written,
      // so there is nothing to report and nothing to record.
      if (saved) {
        deps.onSaved(`Sent: ${saved}`)
        // The sent ledger is Reviews-tab-gated with staleTime Infinity, so a
        // refetch of it would be silently skipped while the tab is off
        // screen. Invalidating is honored the moment it comes back.
        await invalidateShareExports()
      }
    } catch (e) {
      deps.onError(String(e))
    } finally {
      shareBusy.value = false
      shareOpen.value = false
      shareKeys.value = []
    }
  }

  return {
    shareOpen,
    shareKeys,
    shareOrigin,
    shareBusy,
    shareManifest,
    shareMissing,
    shareSummary,
    shareSubject,
    shareBlocked,
    requestShare,
    closeShare,
    showMissingOnMatches,
    confirmShare,
  }
}
