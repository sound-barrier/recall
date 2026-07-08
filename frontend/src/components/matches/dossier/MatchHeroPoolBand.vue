<script setup lang="ts">
import { computed, ref } from 'vue'
import { useFullDossier } from '@/composables/dashboard/useDossier'
import { useOWData } from '@/composables/shared/useOWData'
import { useWidgetConfig } from '@/composables/dashboard/useWidgetConfig'
import { heroDisciplineSchema, type HeroDisciplineConfig } from '@/dashboard/widgets'
import WidgetConfigPopover from '@/components/dashboard/WidgetConfigPopover.vue'

// HERO POOL — a full-width dossier section (sibling of Campaign Log +
// Geography). Three columns over the narrowed set: the derived pool (heroes
// with max(5, 10% of decisive games) meaningful decisive games), the in-pool
// vs out-of-pool discipline split, and each out-of-pool hero's record
// worst-first — "a swap to ana rarely ends in a win" as data. The gear holds
// the shared point-touch threshold (heroes under it never count as played).

// The FULL dossier (hidden-stripped corpus), not the narrowed one: the pool
// is an identity metric — narrowing to one hero must not collapse "your pool"
// to that hero — and a narrow-stable height keeps the band from shifting the
// page when the Hero × Game-Mode band above it drills (its drill narrows the
// whole set; a resizing band here would defeat the list's scroll anchoring).
// Windowed/filtered pool analysis lives on the Compare tab.
const dossier = useFullDossier()
const ow = useOWData()
const { config } = useWidgetConfig<HeroDisciplineConfig>('hero-pool', heroDisciplineSchema)

const analysis = dossier.heroPool(() => ({ thresholdPct: config.value.thresholdPct }))

const heroLabel = (h: string) => ow.heroDisplayName(h) || h

// The pool arrives Tank → DPS → Support (then alphabetical); group the
// consecutive role runs so the list reads like a team composition.
const ROLE_LABEL: Record<string, string> = { tank: 'Tank', dps: 'DPS', support: 'Support' }

const poolGroups = computed(() => {
  const groups: { role: string; label: string; heroes: typeof analysis.value.pool }[] = []
  for (const hero of analysis.value.pool) {
    const last = groups[groups.length - 1]
    if (last && last.role === hero.role) last.heroes.push(hero)
    else groups.push({ role: hero.role, label: ROLE_LABEL[hero.role] ?? 'Other', heroes: [hero] })
  }
  return groups
})

function record(row: { wins: number; losses: number }): string {
  return `${row.wins}W–${row.losses}L`
}

// ── Config gear ──
const configDef = {
  id:      'hero-pool',
  eyebrow: 'Hero pool',
  config:  heroDisciplineSchema,
}
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
      <span id="hp-eyebrow" class="hp-eyebrow">Hero Pool</span>
      <span class="hp-sub">Pool · discipline · what swaps cost</span>
      <button
        type="button"
        class="hp-gear"
        :class="{ 'hp-gear-active': !configIsDefault }"
        :aria-label="configIsDefault ? 'Configure the Hero Pool band' : 'Hero Pool settings are customised'"
        :aria-expanded="configOpen"
        title="Point-touch threshold"
        data-widget-config-trigger
        data-hero-pool-config-trigger
        @click.stop="toggleConfig"
      >
        <span aria-hidden="true">⚙</span>
      </button>
    </header>

    <p v-if="analysis.pool.length === 0" class="hp-empty">
      A hero joins your pool after 5+ meaningful decisive games
      (10% of your games once your history grows).
    </p>

    <div v-else class="hp-cols">
      <div class="hp-col">
        <h4 class="hp-col-title">
          The pool · Tank → DPS → Support
        </h4>
        <template v-for="group in poolGroups" :key="group.role">
          <p class="hp-role-label" :data-pool-role="group.role || 'other'">
            {{ group.label }}
          </p>
          <ul class="hp-list">
            <li v-for="hero in group.heroes" :key="hero.key" data-pool-hero>
              <span class="hp-name">{{ heroLabel(hero.key) }}</span>
              <span class="hp-bar"><span class="hp-fill" :style="{ width: hero.winrate + '%' }" /></span>
              <span class="hp-stat">{{ hero.total }}x · {{ hero.winrate }}%</span>
            </li>
          </ul>
        </template>
      </div>

      <div class="hp-col">
        <h4 class="hp-col-title">
          Discipline
        </h4>
        <ul class="hp-list">
          <li data-pool-split="pure">
            <span class="hp-name">In pool</span>
            <span class="hp-bar"><span class="hp-fill" :style="{ width: analysis.split.pure.winrate + '%' }" /></span>
            <span class="hp-stat">{{ analysis.split.pure.games }}x · {{ analysis.split.pure.winrate }}%</span>
          </li>
          <li data-pool-split="out">
            <span class="hp-name">Out of pool</span>
            <span class="hp-bar"><span class="hp-fill is-out" :style="{ width: analysis.split.out.winrate + '%' }" /></span>
            <span class="hp-stat">{{ analysis.split.out.games }}x · {{ analysis.split.out.winrate }}%</span>
          </li>
        </ul>
      </div>

      <div class="hp-col">
        <h4 class="hp-col-title">
          Out-of-pool swaps
        </h4>
        <ul class="hp-list">
          <li v-if="analysis.outHeroes.length === 0" class="hp-none">
            None — every game stayed in the pool.
          </li>
          <li v-for="hero in analysis.outHeroes" :key="hero.key" data-pool-out-hero>
            <span class="hp-name">↳ {{ heroLabel(hero.key) }}</span>
            <span class="hp-bar"><span class="hp-fill is-out" :style="{ width: hero.winrate + '%' }" /></span>
            <span class="hp-stat">
              {{ record(hero) }} · {{ hero.winrate }}%
              <span
                v-if="hero.lowSample"
                data-low-sample
                class="hp-low-n"
                :title="`Only ${hero.total} matches on this hero — treat this rate as noisy`"
              >n&lt;5</span>
            </span>
          </li>
        </ul>
      </div>
    </div>

    <WidgetConfigPopover
      :open="configOpen"
      :def="configDef"
      :anchor="configAnchor"
      @close="configOpen = false"
    />
  </section>
</template>

<style scoped>
.hero-pool-band {
  padding: 0.7rem 1.1rem 0.8rem;
  border: 1px solid var(--border);
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--accent) 4%, transparent) 0%, transparent 40%),
    var(--surface);
  border-radius: 2px;
}

.hp-head {
  display: flex;
  align-items: baseline;
  gap: 1.1rem;
  margin-bottom: 0.6rem;
  flex-wrap: wrap;
}

.hp-eyebrow {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--accent-text);
  font-weight: 700;
}

.hp-sub {
  font-family: var(--mono);
  font-size: 0.65rem;
  letter-spacing: 0.04em;
  color: var(--text-faint);
}

.hp-gear {
  appearance: none;
  margin-left: auto;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: transparent;
  color: var(--text-faint);
  font-size: 0.75rem;
  line-height: 1;
  padding: 0.25rem 0.4rem;
  cursor: pointer;
}

.hp-gear:hover {
  color: var(--text);
  border-color: var(--accent);
}

.hp-gear:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.hp-gear-active {
  color: var(--accent-text);
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
}

.hp-empty {
  margin: 0.3rem 0 0.4rem;
  font-size: 0.78rem;
  font-style: italic;
  color: var(--text-faint);
}

.hp-cols {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0 2rem;
}

@media (width <= 900px) {
  .hp-cols {
    grid-template-columns: 1fr;
    gap: 0.9rem 0;
  }
}

.hp-role-label {
  margin: 0.45rem 0 0.25rem;
  font-family: var(--mono);
  font-size: 0.58rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--accent-text);
}

.hp-col-title {
  margin: 0 0 0.4rem;
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--text-faint);
}

.hp-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.hp-list li {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 0.78rem;
}

.hp-name {
  flex: 0 0 7.5rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-dim);
}

.hp-bar {
  flex: 1 1 auto;
  height: 6px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--text-faint) 18%, transparent);
  overflow: hidden;
}

.hp-fill {
  display: block;
  height: 100%;
  background: var(--win);
}

.hp-fill.is-out {
  background: var(--loss);
}

.hp-stat {
  flex: 0 0 auto;
  font-family: var(--mono);
  font-size: 0.7rem;
  font-variant-numeric: tabular-nums;
  color: var(--text);
}

.hp-none {
  font-style: italic;
  color: var(--text-faint);
}

.hp-low-n {
  display: inline-block;
  margin-left: 0.25rem;
  padding: 0 0.28rem;
  border-radius: 2px;
  background: var(--loss-soft);
  color: var(--text);
  border: 1px solid var(--loss-line);
  font-family: var(--mono);
  font-size: 0.6rem;
}
</style>
