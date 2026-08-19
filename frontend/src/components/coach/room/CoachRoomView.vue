<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue'

import type { MatchRecord } from '@/api-client'
import CoachDesk from '@/components/coach/room/CoachDesk.vue'
import CoachIdentityPrompt from '@/components/coach/room/CoachIdentityPrompt.vue'
import CoachReel from '@/components/coach/reel/CoachReel.vue'
import CoachSessionSheet from '@/components/coach/notes/CoachSessionSheet.vue'
import {
  DEFAULT_COACH_LABELS, type CoachLabels, type CoachPlayerView, type CoachSaveState, type RoomVoice,
} from '@/components/coach/room/coach-room-props'
import { useCoachReelKeyboard } from '@/composables/coach/useCoachReelKeyboard'
import { useCoachRoom } from '@/composables/coach/useCoachRoom'
import { momentSaveKey, type CoachMoment } from '@/match/coach/coach-moments'
import { SUMMARY_SAVE_KEY, notesSummaryLine, type CoachNoteDraft } from '@/match/coach/coach-notes'

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
  /** True once ending has been asked about and not yet confirmed. */
  endArmed?: boolean
  canExport?: boolean
  exportReason?: string
  labels?: CoachLabels
  /**
   * Whose matches the room shows. 'their' (a coach's session over a loaned
   * bundle) is the default; 'your' is the player's own review sitting: the
   * reel is titled for you with no clock note, the card's possessives read
   * "your", and there is nobody to ask "who is this bundle about".
   */
  voice?: RoomVoice
  /**
   * Why writes are refused right now, from outside the room — the player's
   * own write gate (a read-only profile) in self mode. The room's own reason
   * (nobody confirmed yet, in a coach session) is OR'd with it.
   */
  lockedReason?: string
  /**
   * A sitting whose own blocks should not be quoted back at its author: the
   * one open on this desk. Its note is the editor, not "already said".
   */
  omitReviewId?: string
}>(), {
  moments: () => ({}),
  selectedKey: '',
  summary: '',
  coachName: '',
  saveStateFor: (): CoachSaveState => 'idle',
  endArmed: false,
  canExport: true,
  exportReason: undefined,
  labels: () => DEFAULT_COACH_LABELS,
  voice: 'their',
  lockedReason: '',
  omitReviewId: '',
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
  'keep-working': []
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

const notesLine = computed(() => notesSummaryLine(props.notes, props.coachName, props.moments))

// A moment queues under its own key, so its save state cannot be read off the
// match's. Without this a rejected moment left the row looking exactly like a
// saved one, and the only signal anywhere was the Export button turning off
// with a message that named neither the moment nor the match.
const momentSaveStateFor = (momentId: string): CoachSaveState =>
  props.saveStateFor(momentSaveKey(momentId))

// Nobody confirmed: the room has to ask before it lets a word be typed,
// because a note about a nameless player has no row to land in. Your own
// sitting names nobody and asks nothing.
const unconfirmed = computed(() => props.voice !== 'your' && props.player.handle === '')
const UNCONFIRMED_REASON
  = 'Say who this bundle is about before writing notes — nothing can be saved without it.'
const blockedReason = computed(() => (unconfirmed.value ? UNCONFIRMED_REASON : props.lockedReason))

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
  <!-- A region inside the Reviews tabpanel, not a panel of its own: the tab
       is the panel, and goToView focuses #panel-<view>. -->
  <section id="film-room" class="coach-room" role="region" aria-label="Film room" tabindex="-1">
    <!-- The room finally says its own name — three other surfaces send you
         to "the film room", and until now no surface wore the words. -->
    <p class="eyebrow coach-room-title">
      {{ voice === 'your' ? 'Film room · your review' : `Film room · reviewing ${player.handle}` }}
    </p>
    <div ref="reelColumn" class="coach-room-reel" @keydown="onReelKeydown">
      <slot name="reel">
        <CoachReel
          :handle="player.handle"
          :days="room.reelDays.value"
          :selected-key="room.activeKey.value"
          :notes="notes"
          :labels="labels"
          :voice="voice"
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
          :reel-empty="room.frames.value.length === 0"
          :handle="player.handle"
          :draft="room.activeDraft.value"
          :moments="props.moments[room.activeKey.value] ?? []"
          :moment-save-state="momentSaveStateFor"
          :save-state="saveStateFor(room.activeKey.value)"
          :blocked-reason="blockedReason"
          :has-prev="room.prevKey.value !== null"
          :has-next="room.nextKey.value !== null"
          :labels="labels"
          :voice="voice"
          :omit-review-id="omitReviewId"
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
      <!-- The derived record travels with the slot, so a caller composing its
           own sheet (the self-review sitting's) reads the same numbers the
           default one does. -->
      <slot
        name="sheet"
        :wld="room.wld.value"
        :win-rate="room.winRate.value"
        :focus-tally="room.focusTally.value"
        :notes-line="notesLine"
      >
        <CoachSessionSheet
          :player="player"
          :wld="room.wld.value"
          :win-rate="room.winRate.value"
          :focus-tally="room.focusTally.value"
          :notes-line="notesLine"
          :summary="summary"
          :summary-save-state="saveStateFor(SUMMARY_SAVE_KEY)"
          :end-armed="endArmed"
          :can-export="canExport"
          :export-reason="exportReason"
          :blocked-reason="blockedReason"
          @update-summary="(text: string) => emit('update-summary', text)"
          @change-player="correcting = true"
          @export="emit('export')"
          @end="emit('end')"
          @keep-working="emit('keep-working')"
        />
      </slot>
    </div>
  </section>
</template>

<style scoped src="./coach-room.css"></style>
