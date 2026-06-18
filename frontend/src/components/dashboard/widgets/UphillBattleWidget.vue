<script setup lang="ts">
// Uphill battles — competitive games you won while NOT favoured (the
// "uphill battle" rank-update modifier). A clutch / over-performance
// signal. Opt-in.
import { useDossier } from '@/composables/dashboard/useDossier'

const dossier = useDossier()
const record = dossier.modifierRecord(() => ({ modifier: 'uphill battle' }))
</script>

<template>
  <span class="kpi-eyebrow">Uphill battles</span>
  <span class="kpi-value">{{ record?.total ?? 0 }}</span>
  <span class="kpi-sub">wins as the underdog</span>
</template>
