<script setup lang="ts">
// Reversals — competitive games you LOST while favoured (the "reversal"
// rank-update modifier). A choke / under-performance signal — the mirror
// of Uphill Battles. Opt-in.
import { useDossier } from '@/composables/dashboard/useDossier'

const dossier = useDossier()
const record = dossier.modifierRecord(() => ({ modifier: 'reversal' }))
</script>

<template>
  <span class="kpi-eyebrow">Reversals</span>
  <span class="kpi-value">{{ record?.total ?? 0 }}</span>
  <span class="kpi-sub">losses when favoured</span>
</template>
