<script setup lang="ts">
// How concentrated the hero pool is, weighted by TIME.
//
// The pool-size tile counts heroes past a threshold; this asks whether the
// shape of that list is a pool or one pick with company. Reported as
// "effective heroes" — how many an even spread would need to look like this —
// because "3.2 heroes" reads to a player deciding whether to widen, and "0.31"
// does not.
import { computed } from 'vue'
import { useDossier } from '@/composables/dashboard/useDossier'

const dossier = useDossier()
const pool = dossier.heroConcentration()

const headline = computed(() =>
  pool.value.score === null ? '—' : String(pool.value.effectiveHeroes))

const detail = computed(() => {
  const p = pool.value
  if (p.score === null) return 'No hero play time in this set.'
  const shape = p.overReliance
    ? `over half your time is ${p.overReliance}`
    : 'spread across them'
  // Heroes whose play time went unread are in no part of the number. Naming
  // them is the difference between "spread across five" and "spread across
  // the five of nine we could measure".
  const unread = p.unreadHeroes > 0 ? ` · ${p.unreadHeroes} unread` : ''
  return `${p.heroes} played · ${shape}${unread}`
})

// The tint is a judgment, so the word rides in the name (WCAG 1.4.1). Narrow
// is not automatically bad — a one-trick who wins is winning — so the name
// describes the SHAPE rather than grading it.
const spokenName = computed(() => {
  const p = pool.value
  if (p.score === null) return undefined
  return `${p.effectiveHeroes} effective heroes — ${p.overReliance ? 'concentrated' : 'spread'}`
})
</script>

<template>
  <span class="eyebrow kpi-eyebrow">Effective hero pool</span>
  <span
    class="kpi-value"
    :role="spokenName ? 'img' : undefined"
    :aria-label="spokenName"
  >{{ headline }}</span>
  <span class="kpi-sub">{{ detail }}</span>
</template>
