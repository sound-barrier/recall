<script setup lang="ts">
// "I was good before the nerf" — the same set, split at a patch.
//
// It names the patch it split on, because a before/after with no boundary is
// two numbers and an implication. The patch chosen is the newest one this set
// actually straddles: splitting on one every match predates would put the
// whole history on one side and present it as a comparison.
import { computed } from 'vue'
import { useDossier } from '@/composables/dashboard/useDossier'
import { useOWData } from '@/composables/shared/useOWData'
import { splitByPatch } from '@/match/dossier/match-patch-split'

const dossier = useDossier()
const { patches } = useOWData()

const split = computed(() => splitByPatch(dossier.records.value, patches.value))

const rows = computed(() => [
  { key: 'Before', ...split.value.before },
  { key: 'After', ...split.value.after },
])

const heading = computed(() => {
  const p = split.value.patch
  return p ? `Around ${p.name}` : 'Before / after a patch'
})

const anySample = computed(() => rows.value.some((r) => r.sample > 0))
</script>

<template>
  <header class="breakdown-head">
    <span class="eyebrow accent breakdown-eyebrow">{{ heading }}</span>
  </header>
  <p v-if="!split.patch" class="kpi-sub">
    No patch has landed in this set.
  </p>
  <p v-else-if="!anySample" class="kpi-sub">
    Nothing decisive on either side of it.
  </p>
  <ul v-else>
    <li v-for="row in rows" :key="row.key">
      <span class="bd-name">{{ row.key }}</span>
      <span class="bd-bar">
        <span
          class="bd-fill"
          role="progressbar"
          :aria-valuenow="row.winrate ?? undefined"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-label="`${row.key} the patch, winrate`"
          :style="{ width: (row.winrate ?? 0) + '%' }"
        />
        <span class="bd-time">{{ row.sample }}x</span>
      </span>
      <span class="bd-stats">{{ row.winrate === null ? 'no games' : `${row.winrate}%` }}</span>
    </li>
  </ul>
</template>
