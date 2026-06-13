import { usePersistedRef } from './usePersistedRef'

// Trailing-window selector (1M / 3M / 6M / 12M) shared by the dashboard
// bands (hero×mode, map×role) and the Campaign Log heatmap. Each call site
// passes its own localStorage key; the choice persists across reloads and
// defaults to 6M. Extracted from the three SFCs that hand-rolled the same
// load/clamp/persist trio (rule of three) onto the usePersistedRef factory.
const WINDOW_MONTHS = [1, 3, 6, 12] as const
export type WindowMonths = (typeof WINDOW_MONTHS)[number]

function isWindowMonths(n: number): n is WindowMonths {
  return (WINDOW_MONTHS as readonly number[]).includes(n)
}

export function useWindowMonths(storageKey: string, defaultValue: WindowMonths = 6) {
  const { value: windowMonths, set: pickWindow } = usePersistedRef<WindowMonths>({
    key: storageKey,
    defaultValue,
    parse: (raw) => {
      const n = Number(raw)
      return isWindowMonths(n) ? n : undefined
    },
  })
  return { WINDOW_MONTHS, windowMonths, pickWindow }
}
