<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'

import type { MatchRecord } from '@/api-client'
import CoachDesk from '@/components/coach/CoachDesk.vue'
import CoachReel from '@/components/coach/CoachReel.vue'
import CoachSessionSheet from '@/components/coach/CoachSessionSheet.vue'
import {
  DEFAULT_COACH_LABELS, type CoachLabels, type CoachPlayerView, type CoachSaveState,
} from '@/components/coach/coach-room-props'
import { useCoachReelKeyboard } from '@/composables/coach/useCoachReelKeyboard'
import { useCoachRoom } from '@/composables/coach/useCoachRoom'
import { notesSummaryLine, type CoachNoteDraft } from '@/match/coach-notes'

// The Film Room: reel · desk · sheet. The shell owns the layout and the
// derived state (useCoachRoom) and nothing else — it takes the loaned
// records and the coach's drafts as props and reports every intent
// upward, so the session store stays the only thing that talks to the
// server. Each region is also a slot, for a caller that wants to
// compose one itself.

const props = withDefaults(defineProps<{
  player: CoachPlayerView
  /** The player's loaned records — never the coach's own. */
  records: MatchRecord[]
  /** The coach's drafts, keyed by match key. */
  notes: Record<string, CoachNoteDraft>
  selectedKey?: string
  summary?: string
  /** Signed on the notes; the sheet's tally line names the coach. */
  coachName?: string
  saveState?: CoachSaveState
  canExport?: boolean
  exportReason?: string
  labels?: CoachLabels
}>(), {
  selectedKey: '',
  summary: '',
  coachName: '',
  saveState: 'idle',
  canExport: true,
  exportReason: undefined,
  labels: () => DEFAULT_COACH_LABELS,
})

const emit = defineEmits<{
  select: [matchKey: string]
  'update-note': [matchKey: string, draft: CoachNoteDraft]
  'update-summary': [text: string]
  export: []
  end: []
}>()

const room = useCoachRoom({
  records: () => props.records,
  notes: () => props.notes,
  selectedKey: () => props.selectedKey,
})

const reelColumn = useTemplateRef<HTMLElement>('reelColumn')
const select = (matchKey: string) => emit('select', matchKey)

const { onReelKeydown } = useCoachReelKeyboard({
  keys: () => room.frames.value.map((frame) => frame.match_key),
  activeKey: room.activeKey,
  select,
  reel: reelColumn,
})

const notesLine = computed(() => notesSummaryLine(props.notes, props.coachName))

function step(key: string | null): void {
  if (key !== null) select(key)
}
</script>

<template>
  <section id="panel-coach" class="coach-room" aria-label="Film room" tabindex="-1">
    <div ref="reelColumn" class="coach-room-reel" @keydown="onReelKeydown">
      <slot name="reel">
        <CoachReel
          :handle="player.handle"
          :days="room.reelDays.value"
          :selected-key="room.activeKey.value"
          :notes="notes"
          :labels="labels"
          @select="select"
        />
      </slot>
    </div>

    <div class="coach-room-desk">
      <slot name="desk">
        <CoachDesk
          :record="room.selectedRecord.value"
          :handle="player.handle"
          :draft="room.activeDraft.value"
          :save-state="saveState"
          :has-prev="room.prevKey.value !== null"
          :has-next="room.nextKey.value !== null"
          :labels="labels"
          @update-note="(draft: CoachNoteDraft) => emit('update-note', room.activeKey.value, draft)"
          @prev="step(room.prevKey.value)"
          @next="step(room.nextKey.value)"
        />
      </slot>
    </div>

    <div class="coach-room-sheet">
      <slot name="sheet">
        <CoachSessionSheet
          :player="player"
          :wld="room.wld.value"
          :win-rate="room.winRate.value"
          :focus-tally="room.focusTally.value"
          :notes-line="notesLine"
          :summary="summary"
          :can-export="canExport"
          :export-reason="exportReason"
          @update-summary="(text: string) => emit('update-summary', text)"
          @export="emit('export')"
          @end="emit('end')"
        />
      </slot>
    </div>
  </section>
</template>

<style scoped src="./coach-room.css"></style>
