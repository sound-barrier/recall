<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue'

import { useDossier } from '@/composables/dashboard/useDossier'
import { rankLadderOption, winrateOption } from '@/components/matches/trends/trend-options'

// ECharts is heavy; defer it to its own chunk that only loads when the
// user opens the section (the v-if below gates the mount).
const TrendChart = defineAsyncComponent(() => import('@/components/matches/trends/TrendChart.vue'))

// Time-series come from the dossier, so the charts track the same
// narrowed set as the rest of the workspace. Both split by role bucket
// (role queue → per-role lines, open queue → one line).
const dossier = useDossier()

const expanded = ref(false)
const windowSize = ref<number>(20)

const rankSeries = dossier.rankLadder
const winrateSeries = dossier.rollingWinrate(windowSize)

const rankChartOption = computed(() => rankLadderOption(rankSeries.value))
const winrateChartOption = computed(() => winrateOption(winrateSeries.value))

const rankHasData = computed(() => rankSeries.value.some((s) => s.points.length > 0))
const winrateHasData = computed(() => winrateSeries.value.some((s) => s.points.length > 0))
const anyData = computed(() => rankHasData.value || winrateHasData.value)

const WINDOW_OPTIONS = [10, 20, 50] as const
</script>

<template>
  <section class="trends-section" aria-label="Trends">
    <button
      class="trends-toggle"
      :aria-expanded="expanded"
      :aria-controls="expanded ? 'trends-body' : undefined"
      @click="expanded = !expanded"
    >
      <span class="chev" :class="{ open: expanded }" aria-hidden="true">▸</span>
      <span class="trends-title">Trends</span>
      <span class="trends-hint">Rank progression &amp; win-rate over time, by role</span>
    </button>

    <div v-if="expanded" id="trends-body" class="trends-body">
      <p v-if="!anyData" class="trends-empty">
        No matches with a known date in this set. Trends chart matches with a date and time —
        narrow to a range that includes timestamped matches.
      </p>

      <div v-else class="trends-grid">
        <div class="trend-card">
          <div class="trend-card-head">
            <h4 class="trend-card-title">
              Rank over time
            </h4>
          </div>
          <TrendChart v-if="rankHasData" :option="rankChartOption" caption="Rank progression over time, by role" />
          <p v-else class="trend-card-empty">
            No rank readings — capture a competitive rank screenshot to track your climb.
          </p>
        </div>

        <div class="trend-card">
          <div class="trend-card-head">
            <h4 class="trend-card-title">
              Rolling win-rate (%)
            </h4>
            <select v-model.number="windowSize" class="trend-window-select" aria-label="Win-rate window">
              <option v-for="size in WINDOW_OPTIONS" :key="size" :value="size">
                last {{ size }}
              </option>
            </select>
          </div>
          <TrendChart
            v-if="winrateHasData"
            :option="winrateChartOption"
            :caption="`Rolling win rate over the last ${windowSize} matches, by role`"
          />
          <p v-else class="trend-card-empty">
            No decisive matches in the set.
          </p>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.trends-section {
  margin-top: 1rem;
  border-top: 1px solid var(--border);
  padding-top: 0.5rem;
}

.trends-toggle {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  width: 100%;
  padding: 0.35rem 0.25rem;
  background: none;
  border: none;
  color: var(--text);
  cursor: pointer;
  text-align: left;
}

.trends-title {
  font-size: 1rem;
  font-weight: 600;
}

.trends-hint {
  color: var(--text-dim);
  font-size: 0.8rem;
}

.trends-body {
  margin-top: 0.75rem;
}

.trends-empty,
.trend-card-empty {
  color: var(--text-dim);
  font-size: 0.85rem;
  margin: 0;
}

.trends-empty {
  padding: 1.5rem 0.5rem;
}

.trends-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

@media (width <= 720px) {
  .trends-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.trend-card {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.75rem;
  min-width: 0;
}

.trend-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.trend-card-title {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text);
}

.trend-window-select {
  background: var(--surface-2);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.15rem 0.4rem;
  font-size: 0.8rem;
}

.trend-card-empty {
  padding: 2rem 0.5rem;
  text-align: center;
}
</style>
