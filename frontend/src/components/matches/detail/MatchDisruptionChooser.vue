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

<style scoped>
/* Sits at the top of `.match-expanded` so the user reaches it without
   scrolling past stats / heroes. The chips reuse the .badge visual
   vocabulary but carry their own classes so they stay independent of the
   filter chips above. */
.dis-chooser {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
  margin: 0 0 0.85rem;
  padding-bottom: 0.6rem;
  border-bottom: 1px dashed var(--border);
}

.dis-chooser-label { margin-right: 0.4rem; }

.dis-chip {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.22rem 0.6rem;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-family: var(--mono);
  font-size: var(--type-sm);
  letter-spacing: 0.04em;
  color: var(--text-dim);
  cursor: pointer;
  transition: color var(--duration-fast) ease, background var(--duration-fast) ease, border-color var(--duration-fast) ease, transform var(--duration-fast) ease;
}

.dis-chip:hover {
  color: var(--text);
  border-color: var(--text-faint);
  transform: translateY(-1px);
}

.dis-chip.active {
  color: var(--accent-text);
  background: var(--accent-soft);
  border-color: var(--accent);
}

.dis-chip.dis-clear {
  margin-left: auto;
  color: var(--text-faint);
  font-size: var(--type-2xs);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.dis-chip.dis-clear:hover {
  color: var(--loss);
  border-color: var(--loss-line);
  background: var(--loss-soft);
}

.dis-chip-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--type-lg);
  line-height: 1;
}

/* Your side of the scoreboard reads as a loss-tinted problem; the enemy's
   reads as a win-tinted one. Same convention as the leaf-row stamp. */
.dis-chip-glyph.dis-self  { color: var(--loss); }
.dis-chip-glyph.dis-team  { color: var(--loss); }
.dis-chip-glyph.dis-enemy { color: var(--win); }
.dis-chip.active .dis-chip-glyph { color: var(--accent-text); }

@media (prefers-reduced-motion: reduce) {
  .dis-chip { transition: none; }
  .dis-chip:hover { transform: none; }
}
</style>
