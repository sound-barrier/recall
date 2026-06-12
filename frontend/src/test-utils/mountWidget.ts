import { mount, type VueWrapper } from '@vue/test-utils'
import { computed, type Component, type ComputedRef } from 'vue'
import { vi } from 'vitest'
import { DOSSIER_KEY } from '../composables/useDossier'
import { NARROW_KEY, type NarrowApi } from '../composables/useNarrow'
import type {
  AverageKDA,
  BestWinrateHero,
  BreakdownEntry,
  BucketEntry,
  CurrentStreak,
  DaysSinceLastReview,
  HeroBreakdownEntry,
  MapRoleCell,
  MatchesDossier,
  MostPlayedHero,
  ReviewedCount,
  RoleBreakdownEntry,
  TotalTimePlayed,
  WinLossDraw,
  WLDSinceLastReview,
} from '../composables/useMatchesDossier'

// Per-widget test helper that:
//   1. Stubs localStorage so useWidgetConfig hydrates cleanly (the
//      happy-dom default is no-op, which would break the persisted-
//      pref round-trip every widget runs in setup).
//   2. Seeds optional config overrides for the widget under test.
//   3. Provides a mock dossier under DOSSIER_KEY so useDossier()
//      returns the per-test bedrock/query stubs.
//   4. Mounts the widget. Returns the standard VueWrapper so tests
//      can call .text() / .find() / .attributes() directly.
//
// The dossier override is a SHALLOW Partial<MatchesDossier> — each
// override field becomes the literal value the widget sees (refs
// auto-wrap, query helpers return a plain computed). Fields the
// widget doesn't read can be omitted entirely.

type DossierOverride = {
  // Bedrock — pass the inner value; helper wraps in a computed ref.
  winrate?:             number | null
  wld?:                 WinLossDraw
  totalTimePlayed?:     TotalTimePlayed
  averageKDA?:          AverageKDA | null
  reviewedCount?:       ReviewedCount
  daysSinceLastReview?: DaysSinceLastReview
  wldSinceLastReview?:  WLDSinceLastReview | null
  currentStreak?:       CurrentStreak
  longestWinStreak?:    number
  heroPoolSize?:        number
  topRoles?:            RoleBreakdownEntry[]
  playModeBreakdown?:   BreakdownEntry[]
  // Query helper — pass the result; helper yields a function returning
  // a computed wrapping it (window opts ignored in tests).
  mapRoleCounts?:       MapRoleCell[]
  // Query helpers — pass the result and the helper returns a function
  // that yields a computed wrapping that value (ignoring the opts
  // — tests don't usually need to assert opts pass-through here;
  // that's covered in the dossier suite).
  topByCount?:        BreakdownEntry[]
  withWhomBreakdown?: BreakdownEntry[]
  topHeroesByMinutes?: HeroBreakdownEntry[]
  mostPlayedHero?:    MostPlayedHero | null
  bestWinrateHero?:   BestWinrateHero | null
  timeOfDayBuckets?:  BucketEntry[]
  dayOfWeekBuckets?:  BucketEntry[]
  recentResults?:     ('victory' | 'defeat' | 'draw')[]
  heroGameModeCounts?: Array<{ hero: string; gameMode: string; wins: number; losses: number; draws: number; total: number; winrate: number }>
}

function fakeDossier(over: DossierOverride): MatchesDossier {
  const wrap = <T>(v: T | undefined, fallback: T): ComputedRef<T> =>
    computed(() => (v === undefined ? fallback : v))
  const wrapQuery = <T, Opts>(v: T | undefined, fallback: T): (opts?: Opts) => ComputedRef<T> =>
    () => computed(() => (v === undefined ? fallback : v))

  return {
    // Bedrock
    wld:                 wrap(over.wld, { w: 0, l: 0, d: 0, total: 0 }),
    winrate:             wrap(over.winrate, null),
    totalTimePlayed:     wrap(over.totalTimePlayed, { minutes: 0, label: '—', recordsWithTime: 0, recordsTotal: 0 }),
    averageKDA:          wrap(over.averageKDA, null),
    reviewedCount:       wrap(over.reviewedCount, { reviewed: 0, total: 0, percent: 0 }),
    daysSinceLastReview: wrap(over.daysSinceLastReview, { days: null, lastReviewedAt: null }),
    wldSinceLastReview:  wrap(over.wldSinceLastReview, null),
    currentStreak:       wrap(over.currentStreak, { count: 0, result: null, sinceDate: null }),
    longestWinStreak:    wrap(over.longestWinStreak, 0),
    heroPoolSize:        wrap(over.heroPoolSize, 0),
    topRoles:            wrap(over.topRoles, []),
    playModeBreakdown:   wrap(over.playModeBreakdown, [] as BreakdownEntry[]),
    // Query helpers — return functions matching the dossier's signature.
    topByCount:          wrapQuery(over.topByCount, [] as BreakdownEntry[]),
    withWhomBreakdown:   wrapQuery(over.withWhomBreakdown, [] as BreakdownEntry[]),
    topHeroesByMinutes:  wrapQuery(over.topHeroesByMinutes, [] as HeroBreakdownEntry[]),
    mostPlayedHero:      wrapQuery(over.mostPlayedHero, null),
    bestWinrateHero:     wrapQuery(over.bestWinrateHero, null),
    timeOfDayBuckets:    wrapQuery(over.timeOfDayBuckets, [] as BucketEntry[]),
    dayOfWeekBuckets:    wrapQuery(over.dayOfWeekBuckets, [] as BucketEntry[]),
    recentResults:       wrapQuery(over.recentResults, [] as ('victory' | 'defeat' | 'draw')[]),
    heroGameModeCounts:   wrapQuery(over.heroGameModeCounts, []),
    mapRoleCounts:       wrapQuery(over.mapRoleCounts, [] as MapRoleCell[]),
  } as unknown as MatchesDossier
}

// In-memory localStorage shim mirroring mountApp's. happy-dom's
// default is a no-op so the useWidgetConfig persisted ref never
// hydrates without this.
function installLocalStorageShim(): void {
  const storage: Record<string, string> = {}
  vi.stubGlobal('localStorage', {
    getItem:    (k: string) => storage[k] ?? null,
    setItem:    (k: string, v: string) => { storage[k] = String(v) },
    removeItem: (k: string) => { delete storage[k] },
    clear:      () => { for (const k of Object.keys(storage)) delete storage[k] },
    key:        (i: number) => Object.keys(storage)[i] ?? null,
    get length() { return Object.keys(storage).length },
  })
}

export interface MountWidgetOptions {
  // Subset of the dossier to expose to the widget. Fields the widget
  // doesn't read can be omitted.
  dossier?: DossierOverride
  // Optional config seed for widgets that read useWidgetConfig. Keyed
  // on widget id; localStorage is stubbed fresh per mount so the seed
  // hydrates cleanly.
  configSeed?: Record<string, Record<string, unknown>>
  // Optional narrow stub for widgets that need to call into the
  // active-filter handlers (heatmap cell clicks → pickHero +
  // pickGameMode). Tests pass plain spies — the helper wraps them
  // in a minimal NarrowApi shape so useNarrow() resolves.
  narrow?: Partial<NarrowApi>
}

// Mounts the widget with a provided mock dossier + optional config
// seed. Widget tests only need `dossier.<field>` overrides for the
// fields the widget reads — others fall back to safe stubs.
export function mountWidget(
  Component: Component,
  options: MountWidgetOptions = {},
): VueWrapper {
  installLocalStorageShim()
  if (options.configSeed) {
    for (const [id, value] of Object.entries(options.configSeed)) {
      localStorage.setItem(`recall.dashboard.widget-config.${id}`, JSON.stringify(value))
    }
  }
  const dossier = fakeDossier(options.dossier ?? {})
  const narrow = options.narrow ?? {}
  // Cast the component reference through `unknown` because mount's
  // typed overloads can't see the SFC instance type without an
  // import-from-vue inference that the test-utils call site never
  // needs. The runtime path is unaffected.
  return mount(Component as unknown as Parameters<typeof mount>[0], {
    global: {
      provide: {
        [DOSSIER_KEY as symbol]: dossier,
        [NARROW_KEY  as symbol]: narrow,
      },
    },
  }) as VueWrapper
}

