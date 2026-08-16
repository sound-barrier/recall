<script setup lang="ts">
import type { MatchRecord } from '@/api-client'
import CoachMatchCard from '@/components/coach/CoachMatchCard.vue'
import CoachNoteEditor from '@/components/coach/CoachNoteEditor.vue'
import { DEFAULT_COACH_LABELS, type CoachLabels, type CoachSaveState } from '@/components/coach/coach-room-props'
import type { CoachNoteDraft } from '@/match/coach-notes'

// The middle column: the match the coach is looking at, and the note
// she is writing about it. The desk owns no state — the room hands it
// a record and a draft and takes the edits back.

withDefaults(defineProps<{
  /** The frame on the desk; null only when the bundle has no matches. */
  record: MatchRecord | null
  handle: string
  draft: CoachNoteDraft
  saveState?: CoachSaveState
  hasPrev?: boolean
  hasNext?: boolean
  labels?: CoachLabels
}>(), { saveState: 'idle', hasPrev: false, hasNext: false, labels: () => DEFAULT_COACH_LABELS })

const emit = defineEmits<{
  'update-note': [draft: CoachNoteDraft]
  prev: []
  next: []
}>()
</script>

<template>
  <div class="coach-desk">
    <template v-if="record">
      <CoachMatchCard :record="record" :handle="handle" :labels="labels" />
      <CoachNoteEditor
        :match-key="record.match_key"
        :draft="draft"
        :save-state="saveState"
        :has-prev="hasPrev"
        :has-next="hasNext"
        @update="(next: CoachNoteDraft) => emit('update-note', next)"
        @prev="emit('prev')"
        @next="emit('next')"
      />
    </template>
    <p v-else class="desk-empty">
      Pick a frame from the reel to put a match on the desk.
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
