<script setup lang="ts">
import { computed } from 'vue'

import CoachCueRow from '@/components/coach/notes/CoachCueRow.vue'
import type { CoachSaveState } from '@/components/coach/room/coach-room-props'
import { railPosition, sortMoments } from '@/match/coach/coach-cue-geometry'
import { emptyMoment, type CoachMoment } from '@/match/coach/coach-moments'

/**
 * The cue strip — one match's own timeline.
 *
 * The reel down the left is the SESSION's timeline, a day of matches at a
 * time. This is the same idea one level deeper: the axis is a single match's
 * runtime, and each cue is punched at the second it happened.
 *
 * When the match reported a length the rail is PROPORTIONAL, so three notes
 * clustered in the last two minutes read as clustered at a glance. When it
 * did not — game_length is OCR-derived and absent on every manual match — the
 * strip falls back to an even list rather than scaling against a number it
 * does not have.
 */
const props = withDefaults(defineProps<{
  moments: CoachMoment[]
  /** MM:SS from the match, or '' when no capture reported one. */
  gameLength: string
  replayCode: string
  blocked?: boolean
  blockedReason?: string
  /** Where one moment's own autosave stands. */
  saveStateFor?: (momentId: string) => CoachSaveState
}>(), { saveStateFor: () => 'idle' as CoachSaveState, blocked: false, blockedReason: '' })

const emit = defineEmits<{
  update: [moment: CoachMoment]
  remove: [momentId: string]
  'copy-replay': []
}>()

const ordered = computed(() => sortMoments(props.moments))
const scaled = computed(() => ordered.value.some((m) => railPosition(m.matchClock, props.gameLength) !== null))

// The GAP before a row, not its absolute position — and in rem, not a
// percentage.
//
// Both halves of that were wrong before. Feeding the absolute position into a
// per-row margin made the gaps cumulative, so in a sorted strip they only ever
// grew: a 40-second interval drew WIDER than a ten-minute one, which is the
// exact opposite of "clustered notes read as clustered". And a percentage
// margin resolves against the container's INLINE size, so the time axis
// stretched with the panel's width.
const MAX_GAP_REM = 4

function gapBefore(m: CoachMoment, index: number): string | undefined {
  const at = railPosition(m.matchClock, props.gameLength)
  if (at === null) return undefined
  const prev = index === 0 ? 0 : railPosition(ordered.value[index - 1]!.matchClock, props.gameLength)
  if (prev === null) return undefined
  return `${(Math.max(0, at - prev) * MAX_GAP_REM).toFixed(2)}rem`
}

// The id is minted HERE, not by the server: the autosave queue keys on it from
// the first keystroke, so the row needs an identity before anything has been
// saved. crypto.randomUUID is available in every runtime this ships to.
function addMoment() {
  emit('update', emptyMoment(crypto.randomUUID()))
}
</script>

<template>
  <section class="paper cue-strip" aria-label="Moments">
    <div class="cue-strip-head">
      <span class="eyebrow ink">Moments</span>
      <span v-if="scaled" class="cue-length">{{ gameLength }} match</span>
    </div>

    <p v-if="ordered.length === 0" class="cue-empty">
      No moments yet. Mark one while you watch — "3:23, no off-angle" reads back
      far better than a paragraph.
    </p>

    <ol v-else class="cue-list" :class="{ 'cue-list-scaled': scaled }">
      <CoachCueRow
        v-for="(moment, index) in ordered"
        :key="moment.momentId"
        :moment="moment"
        :game-length="gameLength"
        :replay-code="replayCode"
        :blocked="blocked"
        :blocked-reason="blockedReason"
        :save-state="props.saveStateFor(moment.momentId)"
        :index="index"
        :total="ordered.length"
        :style="scaled ? { '--cue-gap': gapBefore(moment, index) } : undefined"
        @update="(next: CoachMoment) => emit('update', next)"
        @remove="emit('remove', moment.momentId)"
        @copy-replay="emit('copy-replay')"
      />
    </ol>

    <button
      type="button"
      class="paper-chip cue-add"
      :disabled="blocked"
      :title="blocked ? blockedReason : undefined"
      @click="addMoment"
    >
      + Mark a moment
    </button>
  </section>
</template>

<style scoped src="./coach-cue-strip.css"></style>
