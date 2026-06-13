import { ref, computed, watch } from 'vue'

// Drill-down navigation stack for the Hero × Game-Mode band: clicking a
// cell pushes a frame (Hero×Mode → that mode's maps → that map's recent
// matches) AND narrows the page to the clicked dimensions; Go-back pops one
// frame, reverting only the picks the band itself applied. A reconciliation
// watcher truncates the stack if the user clears those picks from the rail
// so the breadcrumb never lies. Extracted from MatchHeroModeBand so the SFC
// holds the render levels and this composable holds the stack mechanics.
export interface DrillFrame {
  level: 'maps' | 'matches'
  hero: string
  gameMode: string
  map?: string
  // Which picks WE applied entering this frame (vs already-present), so
  // Go-back reverts only ours.
  added: { hero?: boolean; gameMode?: boolean; map?: boolean }
}

// The slice of useNarrow the drill nav reads — permissive so callers don't
// have to satisfy the full narrow surface. `.value` covers both ref and
// computed Sets.
export interface DrillNavNarrow {
  pickedHeroes: { value: Set<string> }
  pickedGameModes: { value: Set<string> }
  pickedMaps: { value: Set<string> }
  pickHero: (v: string) => void
  pickGameMode: (v: string) => void
  pickMap: (v: string) => void
}

export function useDrillNav(narrow: DrillNavNarrow) {
  const drillStack = ref<DrillFrame[]>([])
  const depth = computed(() => drillStack.value.length)
  const topFrame = computed<DrillFrame | null>(() => drillStack.value[drillStack.value.length - 1] ?? null)

  // Guarded add: pick iff absent; report whether WE added it.
  function ensurePicked(set: Set<string>, value: string, pick: (v: string) => void): boolean {
    if (set.has(value)) return false
    pick(value)
    return true
  }
  // Guarded remove: toggle off iff still present.
  function ensureUnpicked(set: Set<string>, value: string, pick: (v: string) => void): void {
    if (set.has(value)) pick(value)
  }

  function drillToMaps(hero: string, gameMode: string) {
    const added = {
      hero:     ensurePicked(narrow.pickedHeroes.value, hero, narrow.pickHero),
      gameMode: ensurePicked(narrow.pickedGameModes.value, gameMode, narrow.pickGameMode),
    }
    drillStack.value = [...drillStack.value, { level: 'maps', hero, gameMode, added }]
  }
  function drillToMatches(map: string) {
    const f = topFrame.value
    if (!f) return
    const added = { map: ensurePicked(narrow.pickedMaps.value, map, narrow.pickMap) }
    drillStack.value = [...drillStack.value, { level: 'matches', hero: f.hero, gameMode: f.gameMode, map, added }]
  }
  function goBack() {
    const f = topFrame.value
    if (!f) return
    if (f.added.map && f.map) ensureUnpicked(narrow.pickedMaps.value, f.map, narrow.pickMap)
    if (f.added.gameMode)     ensureUnpicked(narrow.pickedGameModes.value, f.gameMode, narrow.pickGameMode)
    if (f.added.hero)         ensureUnpicked(narrow.pickedHeroes.value, f.hero, narrow.pickHero)
    drillStack.value = drillStack.value.slice(0, -1)
  }
  function goToDepth(target: number) {
    while (drillStack.value.length > target) goBack()
  }

  // Reconciliation: if the user clears the picks this band rode on (rail
  // reset, chip ×), truncate the stack to the deepest still-consistent
  // frame so the breadcrumb never lies.
  watch(
    () => [narrow.pickedHeroes.value, narrow.pickedGameModes.value, narrow.pickedMaps.value] as const,
    () => {
      const frames = drillStack.value
      let keep = frames.length
      for (let i = 0; i < frames.length; i++) {
        const f = frames[i]!
        const ok =
          narrow.pickedHeroes.value.has(f.hero) &&
          narrow.pickedGameModes.value.has(f.gameMode) &&
          (f.level !== 'matches' || !f.map || narrow.pickedMaps.value.has(f.map))
        if (!ok) { keep = i; break }
      }
      if (keep < frames.length) drillStack.value = frames.slice(0, keep)
    },
  )

  return { drillStack, depth, topFrame, drillToMaps, drillToMatches, goBack, goToDepth }
}
