<script setup lang="ts">
import { computed, ref } from 'vue'

import type { MatchRecord } from '@/api'
import { useSectionLayout } from '@/composables/matches/useSectionLayout'
import DossierSection from '@/components/matches/dossier/DossierSection.vue'
import MatchTimelineHeader from '@/components/matches/timeline/MatchTimelineHeader.vue'
import MatchMapRoleBand from '@/components/matches/dossier/MatchMapRoleBand.vue'
import MatchHeroModeBand from '@/components/matches/dossier/MatchHeroModeBand.vue'

// Full-width sections below the dossier grid (Campaign Log, Geography).
// Order + visibility come from useSectionLayout (a module singleton, so
// the dossier's Add/Manage menu and this list stay in sync); each band
// wears an inline grip + × via DossierSection for reorder + remove. The
// widgets inside read the shared dossier via useDossier() inject, so
// this component needs only the (hidden-stripped) records for the
// Campaign Log heatmap + the brushable date range it drives.
const props = defineProps<{
  records: MatchRecord[]
  filterFrom: string
  filterTo: string
}>()

const emit = defineEmits<{
  'update:filterFrom': [value: string]
  'update:filterTo': [value: string]
}>()

const sectionLayout = useSectionLayout()

// Top-level binding so the template auto-unwraps it (nested refs on the
// sectionLayout object don't).
const visibleSectionIds = computed(() => sectionLayout.visibleIds.value)

// Section drag-reorder (mouse). Only ever 2-3 full-width rows, so a
// lightweight id-based swap beats the widget grid's index machinery.
const draggingSectionId = ref<string | null>(null)
const sectionDropTargetId = ref<string | null>(null)

function onSectionDragStart(id: string, e: DragEvent) {
  draggingSectionId.value = id
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', id) } catch (_) { /* Firefox needs data set */ }
  }
}
function onSectionDragOver(id: string) {
  if (draggingSectionId.value && draggingSectionId.value !== id) sectionDropTargetId.value = id
}
function onSectionDrop(targetId: string) {
  const dragId = draggingSectionId.value
  draggingSectionId.value = null
  sectionDropTargetId.value = null
  if (!dragId || dragId === targetId) return
  const list = sectionLayout.sections.value
  const from = list.findIndex((s) => s.id === dragId)
  const to = list.findIndex((s) => s.id === targetId)
  if (from !== -1 && to !== -1) sectionLayout.move(from, to)
}
function onSectionDragEnd() {
  draggingSectionId.value = null
  sectionDropTargetId.value = null
}

// Keyboard reorder from a section grip: move it one slot among the
// VISIBLE sections (Arrow up/down).
function onSectionMove(id: string, dir: -1 | 1) {
  const visible = sectionLayout.visibleIds.value
  const vIdx = visible.indexOf(id)
  if (vIdx === -1) return
  const targetId = visible[vIdx + dir]
  if (!targetId) return
  const list = sectionLayout.sections.value
  const from = list.findIndex((s) => s.id === id)
  const to = list.findIndex((s) => s.id === targetId)
  if (from !== -1 && to !== -1) sectionLayout.move(from, to)
}
</script>

<template>
  <!-- Full-width bands below the dossier grid. `records` is already
     hidden-stripped so the Campaign Log reconciles with the dossier. -->
  <template v-if="props.records.length > 0">
    <DossierSection
      v-for="(sectionId, sIdx) in visibleSectionIds"
      :id="sectionId"
      :key="sectionId"
      :label="sectionLayout.labelFor(sectionId)"
      :index="sIdx"
      :count="visibleSectionIds.length"
      :dragging="draggingSectionId === sectionId"
      :drop-target="sectionDropTargetId === sectionId"
      @remove="sectionLayout.remove"
      @move="onSectionMove"
      @drag-start="onSectionDragStart"
      @drag-over="onSectionDragOver"
      @drop="onSectionDrop"
      @drag-end="onSectionDragEnd"
    >
      <MatchTimelineHeader
        v-if="sectionId === 'campaign-log'"
        :records="props.records"
        :filter-from="props.filterFrom"
        :filter-to="props.filterTo"
        @update:filter-from="(v: string) => emit('update:filterFrom', v)"
        @update:filter-to="(v: string) => emit('update:filterTo', v)"
      />
      <MatchMapRoleBand v-else-if="sectionId === 'geography'" />
      <MatchHeroModeBand v-else-if="sectionId === 'hero-game-mode'" />
    </DossierSection>
  </template>
</template>
