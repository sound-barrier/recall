<script setup lang="ts">
import { computed } from 'vue'

import type { MatchRecord } from '@/api-client'
import { DEFAULT_COACH_LABELS, type CoachLabels } from '@/components/coach/coach-room-props'
import { frameNameSuffix, noteMark, type CoachNoteDraft } from '@/match/coach-notes'
import { playerClockTime } from '@/match/coach-time'
import { formatUnknownMapLabel } from '@/match/match-label-helpers'

// One frame on the film strip: the match as a single click target,
// with the coach's mark on the sprocket rail beside it. The mark is
// decoration — the state it carries is spoken by the accessible name's
// suffix ("— note written" / "— reviewed"), so a screen reader hears it
// without the rail.
//
// Times are the PLAYER's naive clock (coach-time.ts), never the
// canonical instant rendered in the coach's zone.

const props = withDefaults(defineProps<{
  record: MatchRecord
  /** The frame on the desk: takes aria-current and the reel's single tab stop. */
  selected?: boolean
  /** The coach's draft for this match, when there is one. */
  draft?: CoachNoteDraft
  labels?: CoachLabels
}>(), {
  selected: false,
  draft: undefined,
  labels: () => DEFAULT_COACH_LABELS,
})

const emit = defineEmits<{ select: [matchKey: string] }>()

const mapName = computed(() => props.labels.map(props.record.data?.map) || formatUnknownMapLabel(props.record))
const heroName = computed(() => props.labels.hero(props.record.data?.hero))
const clock = computed(() => playerClockTime(props.record))
const result = computed(() => props.record.data?.result ?? '')
const resultWord = computed(() => (result.value ? result.value[0]!.toUpperCase() + result.value.slice(1) : ''))
const RESULT_TINT: Record<string, string> = { victory: 'win', defeat: 'loss', draw: 'draw' }
const resultTint = computed(() => RESULT_TINT[result.value] ?? 'none')

const mark = computed(() => noteMark(props.draft))
const playerNote = computed(() => props.record.annotation?.note ?? '')

const accessibleName = computed(
  () => [mapName.value, clock.value, heroName.value, resultWord.value].filter(Boolean).join(' · ') + frameNameSuffix(props.draft),
)
</script>

<template>
  <li class="reel-frame">
    <span class="reel-sprocket" aria-hidden="true">
      <span v-if="mark" class="paper-mark" :class="{ hollow: mark === 'reviewed' }">{{ mark === 'reviewed' ? '✓' : '✎' }}</span>
    </span>
    <button
      type="button"
      class="frame-btn"
      :data-match-key="record.match_key"
      :tabindex="selected ? 0 : -1"
      :aria-current="selected ? 'true' : undefined"
      :aria-label="accessibleName"
      @click="emit('select', record.match_key)"
    >
      <span class="frame-stripe" :class="resultTint" aria-hidden="true" />
      <span class="frame-body">
        <span class="frame-line">
          <span class="frame-map">{{ mapName }}</span>
          <span class="frame-time">{{ clock }}</span>
        </span>
        <span class="frame-line">
          <span class="frame-hero">{{ heroName }}</span>
          <span class="frame-result" :class="resultTint">{{ resultWord }}</span>
        </span>
        <span v-if="playerNote" class="frame-quote">“{{ playerNote }}”</span>
      </span>
    </button>
  </li>
</template>

<style scoped>
/* Frame = sprocket rail + the click target. The rail is a fixed column
   so every frame's left edge lines up down the strip. */
.reel-frame {
  display: grid;
  grid-template-columns: 1.15rem minmax(0, 1fr);
  align-items: stretch;
  gap: 0.35rem;
}

/* Perforations. Two stops of a repeating gradient read as film holes
   without an image; the mark sits on top of them when there is one. */
.reel-sprocket {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius);
  background: repeating-linear-gradient(
    to bottom,
    var(--border-strong) 0 4px,
    transparent 4px 12px
  );
}

.frame-btn {
  display: grid;
  grid-template-columns: 3px minmax(0, 1fr);
  gap: 0.5rem;
  width: 100%;
  padding: 0;
  text-align: left;
  appearance: none;
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  color: var(--text);
  cursor: pointer;
  overflow: hidden;
  transition: background var(--duration-fast) ease, border-color var(--duration-fast) ease;
}

.frame-btn:hover { background: var(--surface-3); border-color: var(--border); }

.frame-btn[aria-current="true"] {
  background: var(--surface-3);
  border-color: var(--accent);
}

.frame-stripe { background: var(--border-strong); }
.frame-stripe.win  { background: var(--win); }
.frame-stripe.loss { background: var(--loss); }
.frame-stripe.draw { background: var(--draw); }

.frame-body {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
  padding: 0.45rem 0.55rem 0.5rem 0;
}

.frame-line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.4rem;
  min-width: 0;
}

.frame-map {
  font-family: var(--display);
  font-style: italic;
  font-size: var(--type-2xl);
  line-height: 1.05;
  color: var(--identity-accent);
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.frame-time {
  font-family: var(--mono);
  font-size: var(--type-xs);
  color: var(--text-faint);
  font-feature-settings: "tnum";
}

.frame-hero {
  font-size: var(--type-sm);
  color: var(--text-dim);
  text-transform: capitalize;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.frame-result {
  font-family: var(--mono);
  font-size: var(--type-3xs);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.frame-result.win  { color: var(--win); }
.frame-result.loss { color: var(--loss); }
.frame-result.draw { color: var(--draw); }

/* The player's own words, clamped to two lines — the desk shows them
   in full. */
.frame-quote {
  display: -webkit-box;
  margin-top: 0.15rem;
  font-size: var(--type-2xs);
  line-height: 1.35;
  color: var(--text-mute);
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
</style>
