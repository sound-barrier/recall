import { inject, provide, type InjectionKey } from 'vue'

import type { useMatchesRowContext } from '@/composables/matches/list/useMatchesRowContext'

/**
 * Provide/inject seam for the row context menu, mirroring useNarrow.
 *
 * A right-click on a match row opens the menu, and the state behind it lives
 * in MatchesView. Reaching it used to mean an emit relayed verbatim through
 * the table and the leaf list — neither of which reads `row-context`, they
 * only carry it (TECHNICAL_DEBT.md section 15). The list did it twice.
 *
 * Only the handler is exposed. A row opens the menu; the menu itself is
 * rendered by the view that owns its state, and nothing below needs to read
 * whether it is open.
 */
export type RowContextApi = Pick<ReturnType<typeof useMatchesRowContext>, 'onRowContext'>

export const ROW_CONTEXT_KEY: InjectionKey<RowContextApi> = Symbol('recall.rowContext')

export function useRowContext(): RowContextApi {
  const ctx = inject(ROW_CONTEXT_KEY)
  if (!ctx) {
    throw new Error(
      'useRowContext() called outside a MatchesView provider. ' +
      'Either render the row inside MatchesView, or call ' +
      'provideRowContext({ onRowContext }) in your test setup.',
    )
  }
  return ctx
}

export function provideRowContext(ctx: RowContextApi): void {
  provide(ROW_CONTEXT_KEY, ctx)
}
