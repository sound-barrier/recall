<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue'

import type { MatchRecord } from '@/api-client'
import CoachDesk from '@/components/coach/room/CoachDesk.vue'
import CoachIdentityPrompt from '@/components/coach/room/CoachIdentityPrompt.vue'
import CoachReel from '@/components/coach/reel/CoachReel.vue'
import CoachSessionSheet from '@/components/coach/notes/CoachSessionSheet.vue'
import {
  DEFAULT_COACH_LABELS, type CoachLabels, type CoachPlayerView, type CoachSaveState,
} from '@/components/coach/room/coach-room-props'
import { useCoachReelKeyboard } from '@/composables/coach/useCoachReelKeyboard'
import { useCoachRoom } from '@/composables/coach/useCoachRoom'
import type { CoachMoment } from '@/match/coach/coach-moments'
import { notesSummaryLine, type CoachNoteDraft } from '@/match/coach/coach-notes'

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
  /** The coach's moments, keyed by match key — several per match. */
  moments?: Record<string, CoachMoment[]>
  selectedKey?: string
  summary?: string
  /** Signed on the notes; the sheet's tally line names the coach. */
  coachName?: string
  /** Where each key's autosave stands — the desk reads the frame it shows. */
  saveStateFor?: (matchKey: string) => CoachSaveState
  canExport?: boolean
  exportReason?: string
  labels?: CoachLabels
}>(), {
  moments: () => ({}),
  selectedKey: '',
  summary: '',
  coachName: '',
  saveStateFor: (): CoachSaveState => 'idle',
  canExport: true,
  exportReason: undefined,
  labels: () => DEFAULT_COACH_LABELS,
})

const emit = defineEmits<{
  select: [matchKey: string]
  'update-note': [matchKey: string, draft: CoachNoteDraft]
  'update-moment': [matchKey: string, moment: CoachMoment]
  'remove-moment': [matchKey: string, momentId: string]
  'copy-replay': [matchKey: string]
  'update-summary': [text: string]
  'confirm-player': [handle: string]
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

// Nobody confirmed: the room has to ask before it lets a word be typed,
// because a note about a nameless player has no row to land in.
const unconfirmed = computed(() => props.player.handle === '')
const UNCONFIRMED_REASON
  = 'Say who this bundle is about before writing notes — nothing can be saved without it.'
const blockedReason = computed(() => (unconfirmed.value ? UNCONFIRMED_REASON : ''))

// A suggested handle is a suggestion: the sheet re-opens the same prompt to
// correct it, and a confirmed correction closes it again.
const correcting = ref(false)
const askingWho = computed(() => unconfirmed.value || correcting.value)
watch(() => props.player.handle, () => { correcting.value = false })

function confirmPlayer(handle: string): void {
  correcting.value = false
  emit('confirm-player', handle)
}

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
      <CoachIdentityPrompt
        v-if="askingWho"
        :key="player.handle"
        :handle="player.handle"
        :unconfirmed="unconfirmed"
        @confirm="confirmPlayer"
        @cancel="correcting = false"
      />
      <slot name="desk">
        <CoachDesk
          :record="room.selectedRecord.value"
          :handle="player.handle"
          :draft="room.activeDraft.value"
          :moments="props.moments[room.activeKey.value] ?? []"
          :save-state="saveStateFor(room.activeKey.value)"
          :blocked-reason="blockedReason"
          :has-prev="room.prevKey.value !== null"
          :has-next="room.nextKey.value !== null"
          :labels="labels"
          @update-note="(draft: CoachNoteDraft) => emit('update-note', room.activeKey.value, draft)"
          @update-moment="(m: CoachMoment) => emit('update-moment', room.activeKey.value, m)"
          @remove-moment="(id: string) => emit('remove-moment', room.activeKey.value, id)"
          @copy-replay="emit('copy-replay', room.activeKey.value)"
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
          :blocked-reason="blockedReason"
          @update-summary="(text: string) => emit('update-summary', text)"
          @change-player="correcting = true"
          @export="emit('export')"
          @end="emit('end')"
        />
      </slot>
    </div>
  </section>
</template>

<style scoped src="./coach-room.css"></style>
