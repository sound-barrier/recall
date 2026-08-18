<script setup lang="ts">
import type { MatchRecord } from '@/api-client'
import CoachCueStrip from '@/components/coach/notes/CoachCueStrip.vue'
import CoachMatchCard from '@/components/coach/room/CoachMatchCard.vue'
import CoachNoteEditor from '@/components/coach/notes/CoachNoteEditor.vue'
import { DEFAULT_COACH_LABELS, type CoachLabels, type CoachSaveState } from '@/components/coach/room/coach-room-props'
import type { CoachMoment } from '@/match/coach/coach-moments'
import type { CoachNoteDraft } from '@/match/coach/coach-notes'

// The middle column: the match the coach is looking at, and the note
// they are writing about it. The desk owns no state — the room hands it
// a record and a draft and takes the edits back.

withDefaults(defineProps<{
  /** The frame on the desk; null only when the bundle has no matches. */
  record: MatchRecord | null
  /** True when the reel has no frames at all — a different kind of empty. */
  reelEmpty?: boolean
  handle: string
  draft: CoachNoteDraft
  /** This match's moments — several per match, unlike the note. */
  moments?: CoachMoment[]
  /** Where one moment's own autosave stands; moments queue per moment id. */
  momentSaveState?: (momentId: string) => CoachSaveState
  saveState?: CoachSaveState
  /** Why the note editor is inert — relayed straight through. */
  blockedReason?: string
  hasPrev?: boolean
  hasNext?: boolean
  labels?: CoachLabels
}>(), {
  moments: () => [],
  momentSaveState: () => 'idle' as CoachSaveState,
  saveState: 'idle',
  blockedReason: '',
  hasPrev: false,
  hasNext: false,
  labels: () => DEFAULT_COACH_LABELS,
})

const emit = defineEmits<{
  'update-note': [draft: CoachNoteDraft]
  'update-moment': [moment: CoachMoment]
  'remove-moment': [momentId: string]
  'copy-replay': []
  prev: []
  next: []
}>()
</script>

<template>
  <div class="coach-desk">
    <template v-if="record">
      <CoachMatchCard :record="record" :handle="handle" :labels="labels" />
      <!--
        The strip sits between the match and the note on purpose: the coach
        watches, marks what they see, and only then writes the overall read.
      -->
      <CoachCueStrip
        :moments="moments"
        :game-length="record.data?.game_length ?? ''"
        :replay-code="record.annotation?.replay_code ?? ''"
        :blocked="blockedReason !== ''"
        :blocked-reason="blockedReason"
        :save-state-for="momentSaveState"
        @update="(m: CoachMoment) => emit('update-moment', m)"
        @remove="(id: string) => emit('remove-moment', id)"
        @copy-replay="emit('copy-replay')"
      />
      <CoachNoteEditor
        :match-key="record.match_key"
        :draft="draft"
        :save-state="saveState"
        :blocked-reason="blockedReason"
        :has-prev="hasPrev"
        :has-next="hasNext"
        @update="(next: CoachNoteDraft) => emit('update-note', next)"
        @prev="emit('prev')"
        @next="emit('next')"
      />
    </template>
    <!--
      Two empties, and they are not the same. "Pick a frame from the reel" was
      shown for both, so the state where there is nothing to pick pointed the
      coach at an empty reel and asked them to choose from it.
    -->
    <p v-else class="desk-empty">
      {{ reelEmpty
        ? 'This bundle holds no matches to review. The player can share more from their Matches tab.'
        : 'Pick a frame from the reel to put a match on the desk.' }}
    </p>
  </div>
</template>

<style scoped>
.coach-desk {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  min-width: 0;
}

.desk-empty {
  margin: 0;
  padding: 2rem 1rem;
  font-size: var(--type-lg);
  color: var(--text-faint);
  text-align: center;
}
</style>
