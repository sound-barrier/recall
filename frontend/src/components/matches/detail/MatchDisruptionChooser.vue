<script setup lang="ts">
import { computed } from 'vue'
import type { DisruptionSide, MatchRecord } from '@/api-client'
import { useWriteGate } from '@/composables/shared/useWriteGate'

// The expanded card's disruption chooser — three side chips (self / ally /
// enemy) + a Clear chip. Mounted twice, once per kind, because leavers and
// throwers are the same shape: a SET of sides, independently toggleable, so a
// match can be tagged on both teams at once.
//
// Each chip is an independent toggle (aria-pressed), NOT a radiogroup — the
// old leaver chooser was single-select and picking a second side replaced the
// first. Emits the full set it wants; the parent persists it with the other
// annotation fields preserved.
const props = defineProps<{
  record: MatchRecord
  kind: 'leavers' | 'throwers'
}>()

const emit = defineEmits<{
  'set-disruption': [matchKey: string, kind: 'leavers' | 'throwers', sides: DisruptionSide[]]
}>()

// Tagging a disruption rewrites the match's annotation — a write.
const { writesLocked, lockedTitle } = useWriteGate()

const SIDES: { side: DisruptionSide; glyph: string; leaverLabel: string; throwerLabel: string }[] = [
  { side: 'self',  glyph: '⊘', leaverLabel: 'I left',     throwerLabel: 'I threw' },
  { side: 'team',  glyph: '↙', leaverLabel: 'Ally left',  throwerLabel: 'Ally threw' },
  { side: 'enemy', glyph: '↗', leaverLabel: 'Enemy left', throwerLabel: 'Enemy threw' },
]

// The glyph encodes the SIDE (which is the axis both kinds share); the section
// label carries the kind. No separate thrower iconography — the row badge and
// this label already say which is which.
const label = computed(() => (props.kind === 'leavers' ? 'Leavers?' : 'Throwers?'))
const sideLabel = (s: (typeof SIDES)[number]) => (props.kind === 'leavers' ? s.leaverLabel : s.throwerLabel)
const current = computed<DisruptionSide[]>(() => props.record.annotation?.[props.kind] ?? [])
const isOn = (side: DisruptionSide) => current.value.includes(side)

function toggle(side: DisruptionSide) {
  const next = isOn(side) ? current.value.filter((s) => s !== side) : [...current.value, side]
  emit('set-disruption', props.record.match_key, props.kind, next)
}
</script>

<template>
  <div class="dis-chooser" role="group" :aria-label="kind === 'leavers' ? 'Leaver annotation' : 'Thrower annotation'">
    <span class="eyebrow dis-chooser-label" aria-hidden="true">{{ label }}</span>
    <button
      v-for="s in SIDES"
      :key="s.side"
      type="button"
      class="dis-chip"
      :class="{ active: isOn(s.side) }"
      :aria-pressed="isOn(s.side)"
      :data-disruption="`${kind}-${s.side}`"
      :disabled="writesLocked"
      :title="lockedTitle(`Tag this match: ${sideLabel(s)}.`)"
      @click="toggle(s.side)"
    >
      <span class="dis-chip-glyph" :class="`dis-${s.side}`" aria-hidden="true">{{ s.glyph }}</span>
      {{ sideLabel(s) }}
    </button>
    <button
      v-if="current.length"
      type="button"
      class="dis-chip dis-clear"
      :data-disruption-clear="kind"
      :disabled="writesLocked"
      :title="lockedTitle(`Remove the ${kind === 'leavers' ? 'leaver' : 'thrower'} annotation.`)"
      @click="emit('set-disruption', record.match_key, kind, [])"
    >
      × Clear
    </button>
  </div>
</template>

<style src="./match-choosers.css"></style>
