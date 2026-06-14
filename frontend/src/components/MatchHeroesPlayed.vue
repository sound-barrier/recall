<script setup lang="ts">
import { ref, computed } from 'vue'
import type { MatchRecord } from '@/api'
import { useOWData } from '@/composables/useOWData'

// The expanded card's collapsible Heroes-Played list — a per-match
// breakdown of every hero with percent-played + play-time + the
// PERSONAL-tab stat grid. Extracted from MatchCardExpanded; takes the
// record + the filter-active predicate, emits filter-toggle when a hero
// name is clicked. Collapse state is local (the card remounts per match).
const props = defineProps<{
  record: MatchRecord
  isActive: (field: string, value: string) => boolean
}>()

const emit = defineEmits<{
  'filter-toggle': [field: string, value: string]
}>()

const ow = useOWData()

// Always start expanded; collapsing is per-card-instance (MatchDetailPanel
// keys MatchCardExpanded by match_key, so each selection mounts fresh).
const heroesExpanded = ref(true)
function toggleHeroesExpanded() { heroesExpanded.value = !heroesExpanded.value }

// Top heroes by percent_played for the collapsed summary line — two fit
// on one row beside the count + chev without wrapping.
const topHeroesPlayed = computed(() => {
  const all = props.record.data?.heroes_played ?? []
  return [...all]
    .sort((a, b) => (b.percent_played ?? 0) - (a.percent_played ?? 0))
    .slice(0, 2)
})
</script>

<template>
  <div v-if="record.data?.heroes_played?.length" class="heroes-played" :class="{ collapsed: !heroesExpanded }">
    <button
      type="button"
      class="heroes-played-toggle"
      :aria-expanded="heroesExpanded"
      :aria-controls="`heroes-played-${record.match_key}`"
      :title="heroesExpanded ? 'Collapse heroes played' : 'Expand heroes played'"
      @click="toggleHeroesExpanded"
    >
      <span class="chev small" :class="{ open: heroesExpanded }" aria-hidden="true">›</span>
      <span class="block-eyebrow">Heroes Played</span>
      <span class="heroes-count" aria-hidden="true">{{ record.data.heroes_played.length }}</span>
      <span v-if="!heroesExpanded" class="heroes-summary">
        <span
          v-for="(hp, idx) in topHeroesPlayed"
          :key="hp.hero"
          class="heroes-summary-entry"
        >
          <span v-if="idx > 0" class="heroes-summary-sep" aria-hidden="true">·</span>
          <span class="heroes-summary-name">{{ ow.heroDisplayName(hp.hero) }}</span>
          <span class="heroes-summary-pct">{{ hp.percent_played }}%</span>
        </span>
        <span v-if="(record.data.heroes_played.length ?? 0) > topHeroesPlayed.length" class="heroes-summary-more">
          +{{ (record.data.heroes_played.length ?? 0) - topHeroesPlayed.length }}
        </span>
      </span>
    </button>
    <div
      v-if="heroesExpanded"
      :id="`heroes-played-${record.match_key}`"
      class="heroes-played-items"
    >
      <div v-for="hp in record.data.heroes_played" :key="hp.hero" class="hero-block">
        <div class="hero-header">
          <button
            type="button"
            class="hero-name clickable"
            :class="{ active: isActive('hero', hp.hero) }"
            :aria-label="`Filter by hero: ${ow.heroDisplayName(hp.hero)}`"
            :aria-pressed="isActive('hero', hp.hero)"
            @click="emit('filter-toggle', 'hero', hp.hero)"
          >
            {{ ow.heroDisplayName(hp.hero) }}
          </button>
          <span class="hero-pct">{{ hp.percent_played }}%</span>
          <span v-if="hp.play_time" class="hero-time">{{ hp.play_time }}</span>
        </div>
        <div v-if="hp.stats && Object.keys(hp.stats).length" class="personal-grid">
          <div v-for="(v, k) in hp.stats" :key="k" class="personal-item">
            <span class="personal-label">{{ k.replace(/_/g, ' ') }}</span>
            <span class="personal-value">{{ v }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ─── Heroes Played list ─────────────────────────────────── */

/* Collapsible block — when collapsed the entire .hero-block grid is
   gone from the DOM (v-if), but the header eyebrow stays as a
   single-line summary so the user reads the count + top heroes
   without expanding. Default is expanded; state is local to the
   card instance, so paginating to the next match re-mounts the
   block in its default-expanded form (the detail panel keys
   MatchCardExpanded by match_key). */

.heroes-played.collapsed { margin-bottom: -0.2rem; }

.heroes-played-toggle {
  appearance: none;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.35rem 0.45rem 0.35rem 0.1rem;
  background: transparent;
  border: 0;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  border-radius: 2px;
  margin-bottom: 0.55rem;
  transition: background 140ms ease;
}

.heroes-played-toggle:hover { background: var(--surface-2); }

.heroes-played-toggle:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.heroes-played .chev.small {
  display: inline-block;
  font-family: var(--mono);
  color: var(--accent);
  transition: transform 200ms ease;
  transform: rotate(90deg);
  width: 0.9rem;
  text-align: center;
}

.heroes-played .chev.small.open { transform: rotate(90deg); }
.heroes-played.collapsed .chev.small { transform: rotate(0deg); }

.heroes-played-toggle .block-eyebrow {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.heroes-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.1rem;
  padding: 0 0.32rem;
  background: var(--surface-3);
  border: 1px solid var(--border);
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  border-radius: 1px;
  font-feature-settings: "tnum";
}

.heroes-summary {
  display: inline-flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin-left: 0.35rem;
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--text-mute);
  font-feature-settings: "tnum";
}

.heroes-summary-entry {
  display: inline-flex;
  align-items: baseline;
  gap: 0.35rem;
}

.heroes-summary-sep { color: var(--text-faint); }

.heroes-summary-name {
  font-family: var(--display);
  font-style: italic;
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--accent);
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.heroes-summary-pct {
  color: var(--text);
  font-weight: 600;
}

.heroes-summary-more {
  padding: 0.05rem 0.32rem;
  background: var(--surface-3);
  border: 1px dashed var(--border);
  color: var(--text-faint);
  font-size: 0.6rem;
  letter-spacing: 0.06em;
  border-radius: 1px;
}

.heroes-played-items {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  animation: heroes-items-in 200ms ease both;
}

@keyframes heroes-items-in {
  from { opacity: 0; transform: translateY(-2px); }
  to   { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .heroes-played-items { animation: none; }
}

.hero-block {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-left: 2px solid var(--accent-soft);
  border-radius: 2px;
  padding: 0.75rem 0.9rem;
}

.hero-header {
  display: flex;
  gap: 0.7rem;
  align-items: baseline;
  margin-bottom: 0.55rem;
}

.hero-name {
  font-family: var(--display);
  font-style: italic;
  font-size: 1.15rem;
  font-weight: 800;
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: 0 0.15rem;
  cursor: pointer;
  transition: color 160ms ease, text-shadow 200ms ease;
}
.hero-name:hover { color: var(--accent-bright); text-shadow: 0 0 16px var(--accent-glow); }
.hero-name.active { text-shadow: 0 0 14px var(--accent-glow); }

.hero-pct {
  font-family: var(--mono);
  font-size: 0.78rem;
  color: var(--text-dim);
  font-feature-settings: "tnum";
}

.hero-time {
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--text-faint);
}

.personal-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(165px, 1fr));
  gap: 1px;
  background: var(--border);
  border: 1px solid var(--border);
}

.personal-item {
  background: var(--surface);
  padding: 0.45rem 0.7rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}

.personal-label {
  font-family: var(--mono);
  font-size: 0.62rem;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.personal-value {
  font-family: var(--mono);
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text);
  font-feature-settings: "tnum";
}

</style>
