<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue'

import type { ObservedContext } from '@/api-client'
import CoachDesk from '@/components/coach/room/CoachDesk.vue'
import CoachIdentityPrompt from '@/components/coach/room/CoachIdentityPrompt.vue'
import CoachOrphanNotes from '@/components/coach/room/CoachOrphanNotes.vue'
import { playerClockOwner } from '@/match/match-time-helpers'
import CoachAddCode from '@/components/coach/reel/CoachAddCode.vue'
import CoachReel from '@/components/coach/reel/CoachReel.vue'
import CoachSessionSheet from '@/components/coach/notes/CoachSessionSheet.vue'
import {
  DEFAULT_COACH_LABELS, type CoachLabels, type CoachPlayerView, type KnownIdentity, type CoachSaveState,
  type RoomApi, type RoomVoice,
} from '@/components/coach/room/coach-room-props'
import { useCoachReelKeyboard } from '@/composables/coach/useCoachReelKeyboard'
import { useCoachRoom } from '@/composables/coach/useCoachRoom'
import { momentSaveKey, type CoachMoment } from '@/match/coach/coach-moments'
import type { FocusItem } from '@/api'
import { FOCUS_SAVE_KEY, notesSummaryLine, type CoachNoteDraft } from '@/match/coach/coach-notes'

// The Film Room: reel · desk · sheet. The shell owns the layout and the
// derived state (useCoachRoom) and nothing else — it takes the loaned
// records and the coach's drafts as props and reports every intent
// upward, so the session store stays the only thing that talks to the
// server. Each region is also a slot, for a caller that wants to
// compose one itself.

const props = withDefaults(defineProps<{
  player: CoachPlayerView
  /** Roster names for the identity prompt — a known name is an existing file. */
  knownIdentities?: KnownIdentity[]
  /**
   * The corpus under review and the four ways to change it, as one bundle.
   * Two stores drive this room and both expose exactly this shape.
   */
  api: RoomApi
  /** Signed on the notes; the sheet's tally line names the coach. */
  coachName?: string
  /** True once ending has been asked about and not yet confirmed. */
  endArmed?: boolean
  /** What the armed End says — state-aware, threaded to the sheet. */
  endArmedLabel?: string
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
  /** Whether the desk may take its match out of the set (a sitting's affordance). */
  removableFrames?: boolean
}>(), {
  knownIdentities: () => [],
  moments: () => ({}),
  selectedKey: '',
  focusItems: () => [],
  coachName: '',
  saveStateFor: (): CoachSaveState => 'idle',
  endArmed: false, endArmedLabel: 'End anyway — notes not exported',
  canExport: true,
  exportReason: undefined,
  labels: () => DEFAULT_COACH_LABELS,
  voice: 'their',
  lockedReason: '',
  omitReviewId: '',
  removableFrames: false,
})

const emit = defineEmits<{
  'copy-replay': [matchKey: string]
  'remove-frame': [matchKey: string]
  'update-focus-items': [items: FocusItem[]]
  'confirm-player': [handle: string, kind: 'player' | 'team']
  export: []
  'export-sheet': []
  end: []
  'keep-working': []
}>()

const room = useCoachRoom({
  records: props.api.records,
  notes: props.api.notes,
  selectedKey: props.api.selectedKey,
})

// Only a corpus the coach typed can grow; a loaned bundle's matches are the
// player's. The api answering neither question is a room that has no codes
// at all (a self-review), which is why both members are optional.
const canAddCodes = computed(() =>
  props.api.sessionSource?.() === 'replay' && props.api.addReplayCode !== undefined)

function addCode(code: string): void {
  props.api.addReplayCode?.(code)
}

// Present only where the coach types the corpus; its absence is what keeps
// the observed-context editor off a bundle's already-parsed frames.
const observedDate = computed(() =>
  props.api.sessionSource?.() === 'replay' ? (props.api.sessionDate?.() ?? '') : '')

const reelColumn = useTemplateRef<HTMLElement>('reelColumn')
const select = (matchKey: string) => props.api.selectKey(matchKey)

const { onReelKeydown } = useCoachReelKeyboard({
  keys: () => room.frames.value.map((frame) => frame.match_key),
  activeKey: room.activeKey,
  select,
  reel: reelColumn,
})

// The notes the session carries but cannot frame — see CoachOrphanNotes.
const orphanNotes = computed(() => {
  const framed = new Set(room.frames.value.map((f) => f.match_key))
  return Object.entries(props.api.notes())
    .filter(([key]) => !framed.has(key))
    .map(([matchKey, draft]) => ({ matchKey, kind: draft.kind, text: draft.text }))
})
const orphanHeading = computed(() => (props.voice === 'your'
  ? 'Your earlier notes'
  : `Earlier notes about ${playerClockOwner(props.player.handle)}`))

const notesLine = computed(() =>
  notesSummaryLine(props.api.notes(), props.coachName, props.api.moments()))

// A moment queues under its own key, so its save state cannot be read off the
// match's. Without this a rejected moment left the row looking exactly like a
// saved one, and the only signal anywhere was the Export button turning off
// with a message that named neither the moment nor the match.
const momentSaveStateFor = (momentId: string): CoachSaveState =>
  props.api.saveStateFor(momentSaveKey(momentId))

// Nobody confirmed: the room has to ask before it lets a word be typed,
// because a note about a nameless player has no row to land in. Your own
// sitting names nobody and asks nothing.
const unconfirmed = computed(() => props.voice !== 'your' && props.player.handle === '')
const UNCONFIRMED_REASON
  = 'Say who this review is about before writing notes — nothing can be saved without it.'
const blockedReason = computed(() => (unconfirmed.value ? UNCONFIRMED_REASON : props.lockedReason))

// A suggested handle is a suggestion: the sheet re-opens the same prompt to
// correct it, and a confirmed correction closes it again.
const correcting = ref(false)
const askingWho = computed(() => unconfirmed.value || correcting.value)
watch(() => props.player.handle, () => { correcting.value = false })

function confirmPlayer(handle: string, kind: 'player' | 'team'): void {
  correcting.value = false
  emit('confirm-player', handle, kind)
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
      {{ voice === 'your' ? 'Film room · your review' : `Film room · reviewing ${playerClockOwner(player.handle)}` }}
    </p>
    <div ref="reelColumn" class="coach-room-reel" @keydown="onReelKeydown">
      <slot name="reel">
        <CoachReel
          :handle="player.handle"
          :subject-kind="player.kind ?? 'player'"
          :days="room.reelDays.value"
          :selected-key="room.activeKey.value"
          :notes="api.notes()"
          :labels="labels"
          :voice="voice"
          @select="select"
        />
      </slot>
      <CoachAddCode v-if="canAddCodes" :add="addCode" />
    </div>

    <div class="coach-room-desk">
      <CoachIdentityPrompt
        v-if="askingWho"
        :key="`${player.handle}|${player.kind ?? 'player'}`"
        :handle="player.handle"
        :kind="player.kind ?? 'player'"
        :known-identities="knownIdentities"
        :unconfirmed="unconfirmed"
        :source="api.sessionSource?.() ?? 'bundle'"
        @confirm="confirmPlayer"
        @cancel="correcting = false"
      />
      <slot name="desk">
        <CoachDesk
          :session-date="observedDate"
          :subject-kind="player.kind ?? 'player'"
          :record="room.selectedRecord.value"
          :reel-empty="room.frames.value.length === 0"
          :handle="player.handle"
          :draft="room.activeDraft.value"
          :moments="api.moments()[room.activeKey.value] ?? []"
          :moment-save-state="momentSaveStateFor"
          :save-state="api.saveStateFor(room.activeKey.value)"
          :blocked-reason="blockedReason"
          :has-prev="room.prevKey.value !== null"
          :has-next="room.nextKey.value !== null"
          :labels="labels"
          :voice="voice"
          :omit-review-id="omitReviewId"
          :removable="removableFrames ? (room.frames.value.length > 1 ? 'yes' : 'last') : 'none'"
          @update-context="(ctx: ObservedContext) => api.setMatchContext?.(room.activeKey.value, ctx)"
          @update-note="(draft: CoachNoteDraft) => api.updateNote(room.activeKey.value, draft)"
          @update-moment="(m: CoachMoment) => api.updateMoment(room.activeKey.value, m)"
          @remove-moment="(id: string) => api.removeMoment(room.activeKey.value, id)"
          @copy-replay="emit('copy-replay', room.activeKey.value)"
          @remove-frame="emit('remove-frame', room.activeKey.value)"
          @prev="step(room.prevKey.value)"
          @next="step(room.nextKey.value)"
        />
      </slot>
      <CoachOrphanNotes :notes="orphanNotes" :heading="orphanHeading" />
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
          :focus-items="api.focusItems()"
          :focus-save-state="api.saveStateFor(FOCUS_SAVE_KEY)"
          :end-armed="endArmed"
          :end-armed-label="endArmedLabel"
          :can-export="canExport"
          :export-reason="exportReason"
          :blocked-reason="blockedReason"
          @update-focus-items="(items: FocusItem[]) => emit('update-focus-items', items)"
          @change-player="correcting = true"
          @export="emit('export')"
          @export-sheet="emit('export-sheet')"
          @end="emit('end')"
          @keep-working="emit('keep-working')"
        />
      </slot>
    </div>
  </section>
</template>

<style scoped src="./coach-room.css"></style>
