import type { Ref } from 'vue'

import { useMatchesRowContext } from '@/composables/matches/list/useMatchesRowContext'
import { useUiStore } from '@/stores/ui'
import type { MatchRecord } from '@/api-client'

/**
 * The leaf-row right-click menu: its state machine, and what each item does.
 *
 * The state machine (open/close, hover preview, replay lookup) already lived in
 * useMatchesRowContext; what sat in MatchesView beside it was eight one-line
 * forwarders naming which store action each menu item runs. Those are the
 * menu's CONTRACT — add an item and this is the file that changes — so they
 * belong with it rather than in the view that happens to render it.
 *
 * The actions are named for what the USER chose ("copy the replay code"),
 * not for the plumbing underneath, so the template reads as the menu does.
 */
export interface RowActionDeps {
  /** Records the menu can act on — the narrowed set the rows come from. */
  records: Ref<MatchRecord[]>
  /** Bulk-hide, reused with a single key so there is one hide path. */
  hideMatches: (keys: string[]) => Promise<unknown> | void
  copyReplayCode: (matchKey: string) => Promise<unknown> | void
  /** Open the Send-to-a-coach dialog over one match. */
  sendToCoach: (matchKey: string) => void
  copyMatchLink: (matchKey: string) => Promise<unknown> | void
  openSourceFolder: (matchKey: string) => Promise<unknown> | void
}

export function useMatchesRowActions(deps: RowActionDeps) {
  const ui = useUiStore()
  const context = useMatchesRowContext(deps.records)

  // The state machine spreads; the actions ride in their own named bundle.
  // Spreading BOTH meant an action and a context key sharing a name would
  // silently overwrite one another in whichever order the spreads ran.
  return {
    ...context,
    rowAction: {
      openDetail: (matchKey: string) => { ui.selection.open(matchKey) },
      setAnchor: (matchKey: string) => { ui.onSetAnchor(matchKey) },
      // Single key through the BULK path deliberately: one hide implementation,
      // so the visibility write, the reload and the undo affordance behave the
      // same whether one row or twenty were chosen.
      hide: (matchKey: string) => { void deps.hideMatches([matchKey]) },
      focusTag: (matchKey: string) => { ui.onOpenMatchAndFocus(matchKey, 'tag') },
      focusNote: (matchKey: string) => { ui.onOpenMatchAndFocus(matchKey, 'note') },
      copyReplay: (matchKey: string) => { void deps.copyReplayCode(matchKey) },
      // One match, straight to the coach dialog. Goes through the bundle
      // rather than an inline binding in the view — the menu's contract
      // lives here, which is the whole reason this file exists.
      sendToCoach: (matchKey: string) => { deps.sendToCoach(matchKey) },
      copyLink: (matchKey: string) => { void deps.copyMatchLink(matchKey) },
      openSourceFolder: (matchKey: string) => { void deps.openSourceFolder(matchKey) },
    },
  }
}
