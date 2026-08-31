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
export type ShareOrigin = 'row' | 'selection' | 'narrow' | 'last-session' | 'suggested'

export interface ShareSubmission {
  handle: string
  message: string
  filename: string
}

/** The half-written dialog — what survives the fix round-trip. */
export interface ShareDraft {
  handle: string
  message: string
}

export interface ShareWithCoachDeps {
  /** The records the keys are resolved against. */
  records: Ref<MatchRecord[]>
  onError: (raw: string) => void
  /** Where the written file landed, for the receipt strip. */
  onSaved: (message: string) => void
  /** Put the code-less matches on screen so they can be fixed. */
  showMatches: (keys: string[], why: string) => Promise<unknown> | void
  /** True while a coaching session is open — see requestShare. */
  sessionActive: () => boolean
}

const SUBJECT: Record<ShareOrigin, (n: number) => string> = {
  row: () => 'This match',
  selection: (n) => `${n} match${n === 1 ? '' : 'es'} you ticked`,
  narrow: (n) => `${n} match${n === 1 ? '' : 'es'} — everything showing on Matches`,
  'last-session': (n) => `Your last session — ${n} match${n === 1 ? '' : 'es'}`,
  suggested: (n) => `${n} match${n === 1 ? '' : 'es'} — suggested, yours to edit`,
}

export function useShareWithCoach(deps: ShareWithCoachDeps) {
  const shareOpen = ref(false)
  const shareKeys = ref<string[]>([])
  // The typed handle and message. Held HERE rather than in the dialog so
  // the sanctioned remediation path — "Show the N on Matches", fix the
  // codes, come back — does not eat the words. Cleared on the two real
  // endings: an explicit close, and a send that succeeded.
  const shareDraft = ref<ShareDraft | null>(null)
  const shareOrigin = ref<ShareOrigin>('selection')
  const shareBusy = ref(false)
  // Bumped on every open, so a send can tell whether the dialog it is
  // finishing for is still the one on screen.
  let openToken = 0

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
    // The four doors each disable their own button, but a disabled button is
    // a courtesy and this is the refusal: during a session the corpus on
    // screen is the coach's loaned one, and sending it on signed with your
    // own handle is the thing that must not happen — keyboard path, forced
    // click or otherwise. Nothing to send is refused here for the same
    // reason: an empty dialog is a dead end, not a decision.
    if (deps.sessionActive() || matchKeys.length === 0) return
    shareKeys.value = [...matchKeys]
    shareOrigin.value = origin
    shareOpen.value = true
    openToken += 1
  }

  /**
   * Replace the set the OPEN dialog is about, without reopening it.
   *
   * requestShare is the door; this is the correction. A suggestion the user
   * cannot edit afterward is a decision taken away from them, so applying
   * one and dropping a row from the manifest are the same operation, and
   * both land here. Everything downstream — the manifest, the gaps, the
   * subject, the refusal — re-derives from the keys, which is the whole
   * reason four entry points never grew four copies of this logic.
   */
  function setShareKeys(matchKeys: readonly string[], origin: ShareOrigin): void {
    if (deps.sessionActive() || !shareOpen.value) return
    shareKeys.value = [...matchKeys]
    shareOrigin.value = origin
  }

  /** Drop one match from the set on screen; the rest of the dialog follows. */
  function dropShareKey(matchKey: string): void {
    setShareKeys(shareKeys.value.filter((k) => k !== matchKey), shareOrigin.value)
  }

  function closeShare(): void {
    shareOpen.value = false
    shareDraft.value = null
  }

  /** The dialog reports every keystroke; the draft is whatever was last typed. */
  function stashShareDraft(draft: ShareDraft): void {
    shareDraft.value = draft
  }

  /** Put the blockers on screen, and get out of the way. */
  async function showMissingOnMatches(): Promise<void> {
    const keys = shareMissing.value.map((row) => row.matchKey)
    shareOpen.value = false
    await deps.showMatches(keys, 'matches missing a replay code')
  }

  async function confirmShare(submission: ShareSubmission): Promise<void> {
    if (deps.sessionActive()) return
    // Which open this send belongs to. shareBusy is composable-scoped, so a
    // user who dismisses mid-flight and reopens over a NEW set would have the
    // second dialog force-closed and its keys wiped when the first settled.
    const token = openToken
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
        // The send succeeded — the words did their job and the draft dies.
        // ONLY here: a failed send and a dismissed save dialog are exactly
        // the retry paths the stash exists for.
        shareDraft.value = null
        // The sent ledger is Reviews-tab-gated with staleTime Infinity, so a
        // refetch of it would be silently skipped while the tab is off
        // screen. Invalidating is honored the moment it comes back.
        await invalidateShareExports()
      }
    } catch (e) {
      deps.onError(String(e))
    } finally {
      shareBusy.value = false
      if (token === openToken) {
        shareOpen.value = false
        shareKeys.value = []
      }
    }
  }

  return {
    shareOpen,
    shareKeys,
    shareDraft,
    setShareKeys,
    dropShareKey,
    stashShareDraft,
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
