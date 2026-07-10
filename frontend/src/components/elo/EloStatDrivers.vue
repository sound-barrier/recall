<script setup lang="ts">
import { computed } from 'vue'
import { useEloCalc } from '@/composables/elo/useEloCalculator'

// "What actually separates your wins" — each scoreboard stat compared
// between wins and losses (per 10 minutes), ranked by standardized gap.
// The top row is the practice lever with the most signal behind it. The
// fine print carries the honesty: association, not causation.
const { drivers } = useEloCalc()

function fmt(v: number): string {
  return v >= 100 ? String(Math.round(v)) : (Math.round(v * 10) / 10).toFixed(1)
}

function strength(p: number | null): string {
  if (p === null) return 'sample too small to test'
  if (p < 0.01) return 'a strong, consistent pattern'
  if (p < 0.05) return 'a real pattern'
  return 'weak — could be noise'
}

const rows = computed(() => drivers.value.map((d) => ({
  key: d.key,
  label: d.label,
  a: `${fmt(d.winMean)} in wins · ${fmt(d.lossMean)} in losses`,
  note: `${d.winMean < d.lossMean ? 'Lower' : 'Higher'} in your wins (${d.nWins}W/${d.nLosses}L measured) — ${strength(d.pValue)}.`,
})))
</script>

<template>
  <section v-if="rows.length > 0" class="elo-playbook-block" aria-labelledby="elo-drivers-title" data-elo-drivers>
    <h4 id="elo-drivers-title" class="elo-subhead">
      What separates your wins from losses
    </h4>
    <p class="elo-band-sub">
      Your scoreboard stats split by result, per 10 minutes — the biggest gap is the lever worth practicing first.
    </p>
    <div class="elo-grid">
      <div v-for="r in rows" :key="r.key" class="elo-cell neutral" :data-elo-driver="r.key">
        <p class="elo-cell-q">
          {{ r.label }}
        </p>
        <p class="elo-cell-a">
          {{ r.a }}
        </p>
        <p class="elo-cell-note">
          {{ r.note }}
        </p>
      </div>
    </div>
    <p class="elo-band-sub elo-fine-print">
      Association, not causation — a steamroll moves every stat at once. Deaths usually carries the most signal: it's the one you control most directly.
    </p>
  </section>
</template>
