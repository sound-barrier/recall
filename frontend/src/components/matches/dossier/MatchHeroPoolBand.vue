<script setup lang="ts">
import { computed, ref } from 'vue'
import { useFullDossier } from '@/composables/dashboard/useDossier'
import { useNarrow } from '@/composables/matches/useNarrow'
import { useOWData } from '@/composables/shared/useOWData'
import { useWidgetConfig } from '@/composables/dashboard/useWidgetConfig'
import { heroDisciplineSchema, type HeroDisciplineConfig } from '@/dashboard/widgets'
import {
  analyzeHeroPool, matchesPoolMode, rankPoolHeroes, roleWinrates,
  type HeroPoolAnalysis, type PoolMode,
} from '@/match/match-hero-pool-helpers'
import { heatmapCellClass, heatmapCellOpacity } from '@/match/match-heatmap-helpers'
import WidgetConfigPopover from '@/components/dashboard/WidgetConfigPopover.vue'

// HERO POOL — a fixed-height scrolling dossier band (mirroring Hero × Game-Mode)
// with a 3-way queue toggle. Rank is tracked per queue, so a pool means
// something different in each:
//   Role Queue — a SEPARATE pool per role (your tank pool ≠ your support pool),
//     each derived over just that role's games, with its own role win rate.
//   Open Queue / Quickplay — one combined pool (you flex; rank is shared).
//
// Within a role/mode, heroes (pool + off-pool together) are ranked by
// statistical significance first (n ≥ 5 outranks a noisy perfect record) then by
// win rate — the same importance the Wilson floor encodes elsewhere. Bars are
// colored by WIN RATE (green→red, faded by volume — the Hero × Game-Mode /
// Map × Role scheme), NOT by pool status, so a high-win off-pool hero reads
// "play this more" and a losing in-pool hero reads "reconsider"; pool membership
// rides a small badge instead.
//
// The toggle defaults to "Showing" Role Queue: the band renders that pool but
// does NOT filter the rest of the dossier until the user picks a mode. Clicking
// a role, a hero, or an In/Out-of-pool chip narrows the whole set (via useNarrow)
// so every other widget reflects it; Reset clears the band's filter.
//
// Pool is computed over the FULL corpus (identity metric), so narrowing never
// collapses "your pool" and the height stays narrow-stable.
const dossier = useFullDossier()
const narrow = useNarrow()
const ow = useOWData()
const { config } = useWidgetConfig<HeroDisciplineConfig>('hero-pool', heroDisciplineSchema)

const MODES: { key: PoolMode; label: string }[] = [
  { key: 'role', label: 'Role Queue' },
  { key: 'open', label: 'Open Queue' },
  { key: 'quickplay', label: 'Quickplay' },
]
const ROLE_ORDER = ['tank', 'dps', 'support'] as const
const ROLE_LABEL: Record<string, string> = { tank: 'Tank', dps: 'DPS', support: 'Support' }

const viewMode = ref<PoolMode>('role')
const threshold = computed(() => config.value.thresholdPct)

const modeRecords = computed(() => dossier.records.value.filter((r) => matchesPoolMode(r, viewMode.value)))
const heroLabel = (h: string) => ow.heroDisplayName(h) || h

// Role Queue: an independent pool per role, heroes ranked significance-then-WR.
interface RoleGroup { role: string; label: string; rateWinrate: number | null; games: number; analysis: HeroPoolAnalysis; ranked: ReturnType<typeof rankPoolHeroes>; keys: string[] }
const roleGroups = computed<RoleGroup[]>(() => {
  if (viewMode.value !== 'role') return []
  const rate = new Map(roleWinrates(modeRecords.value).map((r) => [r.role, r]))
  return ROLE_ORDER.map((role) => {
    const recs = modeRecords.value.filter((r) => r.data?.role === role)
    const analysis = analyzeHeroPool(recs, threshold.value, ow.heroRole)
    const r = rate.get(role)
    return { role, label: ROLE_LABEL[role]!, rateWinrate: r?.winrate ?? null, games: r?.games ?? 0, analysis, ranked: rankPoolHeroes(analysis), keys: analysis.pool.map((h) => h.key) }
  }).filter((g) => g.ranked.length)
})

// Open Queue / Quickplay: one combined pool.
const combined = computed<HeroPoolAnalysis | null>(() =>
  viewMode.value === 'role' ? null : analyzeHeroPool(modeRecords.value, threshold.value, ow.heroRole))
const combinedRanked = computed(() => (combined.value ? rankPoolHeroes(combined.value) : []))
const overallWinrate = computed(() => {
  const c = combined.value
  if (!c) return 0
  const decisive = c.split.pure.decisive + c.split.out.decisive
  return decisive === 0 ? 0 : Math.round(((c.split.pure.wins + c.split.out.wins) / decisive) * 100)
})

const isEmpty = computed(() => (viewMode.value === 'role' ? roleGroups.value.length === 0 : combinedRanked.value.length === 0))
const showingOnly = computed(() =>
  narrow.pickedQueues.value.size === 0 && narrow.pickedPlayModes.value.size === 0 && narrow.poolFilter.value === null)

// ── Interactions — each scopes the global set to the current mode, then adds
//    its own pick (so every other widget reflects it). ────────────────────────
function scopeToMode(mode: PoolMode) {
  narrow.pickedQueues.value = mode === 'quickplay' ? new Set() : new Set([mode])
  narrow.pickedPlayModes.value = new Set([mode === 'quickplay' ? 'quickplay' : 'competitive'])
}

function selectMode(mode: PoolMode) {
  viewMode.value = mode
  narrow.setPoolFilter(null)
  scopeToMode(mode)
}

function clickRole(role: string) {
  scopeToMode(viewMode.value)
  narrow.pickRole(role)
}

function clickHero(key: string) {
  scopeToMode(viewMode.value)
  narrow.pickHero(key)
}

function clickPoolSide(side: 'pure' | 'off', keys: string[], role?: string) {
  scopeToMode(viewMode.value)
  if (role) narrow.pickedRoles.value = new Set([role])
  const active = narrow.poolFilter.value
  narrow.setPoolFilter(active?.side === side ? null : { side, keys, thresholdPct: threshold.value })
}

// Reset clears the filter this band applied (queue/mode scope + role/hero/pool
// picks), returning every widget to the unfiltered set and the band to Showing.
function resetBand() {
  narrow.pickedQueues.value = new Set()
  narrow.pickedPlayModes.value = new Set()
  narrow.pickedRoles.value = new Set()
  narrow.pickedHeroes.value = new Set()
  narrow.setPoolFilter(null)
}

// ── Config gear ──
const configDef = { id: 'hero-pool', eyebrow: 'Hero pool', config: heroDisciplineSchema }
const configOpen = ref(false)
const configAnchor = ref<DOMRect | null>(null)
function toggleConfig(e: MouseEvent) {
  configAnchor.value = (e.currentTarget as HTMLElement).getBoundingClientRect()
  configOpen.value = !configOpen.value
}
const configIsDefault = computed(
  () => config.value.thresholdPct === heroDisciplineSchema.defaults().thresholdPct,
)
</script>

<template>
  <section class="hero-pool-band" aria-labelledby="hp-eyebrow">
    <header class="hp-head">
      <span id="hp-eyebrow" class="eyebrow accent hp-eyebrow">Hero Pool</span>
      <div class="hp-modes" role="group" aria-label="Queue">
        <button
          v-for="m in MODES"
          :key="m.key"
          type="button"
          class="hp-mode-btn"
          :class="{ picked: viewMode === m.key }"
          :aria-pressed="viewMode === m.key ? 'true' : 'false'"
          :data-pool-mode="m.key"
          @click="selectMode(m.key)"
        >
          {{ m.label }}
        </button>
      </div>
      <span v-if="showingOnly" class="hp-showing" aria-hidden="true">Showing · click to filter</span>
      <button
        v-else
        type="button"
        class="hp-reset"
        data-hero-pool-reset
        title="Clear the Hero Pool filter"
        @click="resetBand"
      >
        Reset
      </button>
      <button
        type="button"
        class="hp-gear"
        :class="{ 'hp-gear-active': !configIsDefault }"
        :aria-label="configIsDefault ? 'Configure the Hero Pool band' : 'Hero Pool settings are customized'"
        :aria-expanded="configOpen"
        title="Point-touch threshold"
        data-widget-config-trigger
        data-hero-pool-config-trigger
        @click.stop="toggleConfig"
      >
        <span aria-hidden="true">⚙</span>
      </button>
    </header>

    <p v-if="isEmpty" class="hp-empty">
      No {{ MODES.find((m) => m.key === viewMode)?.label }} games yet — a hero joins your pool
      after 5+ meaningful decisive games (10% of that role's games once your history grows).
    </p>

    <div v-else class="hp-scroll" data-pool-scroll>
      <template v-if="viewMode === 'role'">
        <div v-for="group in roleGroups" :key="group.role" class="hp-role-group" :data-pool-role="group.role">
          <button
            type="button"
            class="hp-role-header"
            :data-pool-role-header="group.role"
            :title="`Filter to ${group.label} matches`"
            @click="clickRole(group.role)"
          >
            <span class="hp-role-name">{{ group.label }}</span>
            <span v-if="group.rateWinrate !== null" class="hp-role-rate">{{ group.rateWinrate }}% · {{ group.games }}x</span>
            <span v-else class="hp-role-rate hp-role-none">no games</span>
          </button>
          <ul class="hp-list">
            <li v-for="hero in group.ranked" :key="hero.key">
              <button
                type="button" class="hp-hero"
                :data-pool-hero="hero.key" :data-pool-out-hero="hero.inPool ? undefined : hero.key"
                @click="clickHero(hero.key)"
              >
                <span class="hp-name">{{ heroLabel(hero.key) }}</span>
                <span class="hp-tag" :class="{ out: !hero.inPool }">{{ hero.inPool ? 'pool' : 'off' }}</span>
                <span class="hp-bar"><span class="hp-fill" :class="heatmapCellClass(hero)" :style="{ width: hero.winrate + '%', opacity: heatmapCellOpacity(hero) }" /></span>
                <span class="hp-stat">
                  {{ hero.total }}x · {{ hero.winrate }}%
                  <span v-if="hero.lowSample" data-low-sample class="hp-low-n" :title="`Only ${hero.total} matches — noisy`">n&lt;5</span>
                </span>
              </button>
            </li>
          </ul>
          <div class="hp-discipline">
            <button
              type="button" class="hp-side"
              :class="{ picked: narrow.poolFilter.value?.side === 'pure' && narrow.pickedRoles.value.has(group.role) }"
              data-pool-side="pure" :data-pool-role="group.role"
              @click="clickPoolSide('pure', group.keys, group.role)"
            >
              In pool · {{ group.analysis.split.pure.winrate }}% ({{ group.analysis.split.pure.games }}x)
            </button>
            <button
              type="button" class="hp-side"
              :class="{ picked: narrow.poolFilter.value?.side === 'off' && narrow.pickedRoles.value.has(group.role) }"
              data-pool-side="off" :data-pool-role="group.role"
              @click="clickPoolSide('off', group.keys, group.role)"
            >
              Out of pool · {{ group.analysis.split.out.winrate }}% ({{ group.analysis.split.out.games }}x)
            </button>
          </div>
        </div>
      </template>

      <template v-else-if="combined">
        <p class="hp-combined-head">
          Combined pool <span class="hp-role-rate">{{ overallWinrate }}% overall</span>
        </p>
        <ul class="hp-list">
          <li v-for="hero in combinedRanked" :key="hero.key">
            <button
              type="button" class="hp-hero"
              :data-pool-hero="hero.key" :data-pool-out-hero="hero.inPool ? undefined : hero.key"
              @click="clickHero(hero.key)"
            >
              <span class="hp-name">{{ heroLabel(hero.key) }}</span>
              <span class="hp-tag" :class="{ out: !hero.inPool }">{{ hero.inPool ? 'pool' : 'off' }}</span>
              <span class="hp-bar"><span class="hp-fill" :class="heatmapCellClass(hero)" :style="{ width: hero.winrate + '%', opacity: heatmapCellOpacity(hero) }" /></span>
              <span class="hp-stat">
                {{ hero.total }}x · {{ hero.winrate }}%
                <span v-if="hero.lowSample" data-low-sample class="hp-low-n" :title="`Only ${hero.total} matches — noisy`">n&lt;5</span>
              </span>
            </button>
          </li>
        </ul>
        <div class="hp-discipline">
          <button
            type="button" class="hp-side"
            :class="{ picked: narrow.poolFilter.value?.side === 'pure' }"
            data-pool-side="pure"
            @click="clickPoolSide('pure', combined.pool.map((h) => h.key))"
          >
            In pool · {{ combined.split.pure.winrate }}% ({{ combined.split.pure.games }}x)
          </button>
          <button
            type="button" class="hp-side"
            :class="{ picked: narrow.poolFilter.value?.side === 'off' }"
            data-pool-side="off"
            @click="clickPoolSide('off', combined.pool.map((h) => h.key))"
          >
            Out of pool · {{ combined.split.out.winrate }}% ({{ combined.split.out.games }}x)
          </button>
        </div>
      </template>
    </div>

    <WidgetConfigPopover :open="configOpen" :def="configDef" :anchor="configAnchor" @close="configOpen = false" />
  </section>
</template>

<style scoped src="./match-hero-pool-band.css"></style>
