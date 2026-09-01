<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import type { MatchRecord, ObservedContext } from '@/api-client'
import CoachCueStrip from '@/components/coach/notes/CoachCueStrip.vue'
import CoachMatchCard from '@/components/coach/room/CoachMatchCard.vue'
import CoachObservedContext from '@/components/coach/room/CoachObservedContext.vue'
import CoachNoteEditor from '@/components/coach/notes/CoachNoteEditor.vue'
import { DEFAULT_COACH_LABELS, type CoachLabels, type CoachSaveState, type RoomVoice } from '@/components/coach/room/coach-room-props'
import type { CoachMoment } from '@/match/coach/coach-moments'
import type { CoachNoteDraft } from '@/match/coach/coach-notes'

// The middle column: the match the coach is looking at, and the note
// they are writing about it. The desk owns no state — the room hands it
// a record and a draft and takes the edits back.

const props = withDefaults(defineProps<{
  /** The frame on the desk; null only when the bundle has no matches. */
  record: MatchRecord | null
  /** True when the reel has no frames at all — a different kind of empty. */
  reelEmpty?: boolean
  /**
   * Today, as the session reckons it. Present only for a session whose
   * matches the coach typed — it is the date a blank observed date falls
   * back to, and its absence is what keeps the editor off a bundle's frames.
   */
  sessionDate?: string
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
  /** Whose matches these are — the card's possessives follow it. */
  voice?: RoomVoice
  /** 'team' widens the observed-context lens: no single hero to ask about. */
  subjectKind?: 'player' | 'team'
  /** The open sitting, whose own block the card must not quote back. */
  omitReviewId?: string
  /**
   * The desk can take its match out of the set — a sitting's affordance
   * ('none' on a coach's loan). 'last' keeps the button visible but
   * refused: a review over nothing is not a state.
   */
  removable?: 'none' | 'yes' | 'last'
}>(), {
  moments: () => [],
  momentSaveState: () => 'idle' as CoachSaveState,
  saveState: 'idle',
  blockedReason: '',
  hasPrev: false,
  hasNext: false,
  labels: () => DEFAULT_COACH_LABELS,
  voice: 'their',
  subjectKind: 'player',
  omitReviewId: '',
  removable: 'none',
  // Empty means "this corpus was parsed, not typed" — which is what keeps
  // the observed-context editor off a bundle's frames.
  sessionDate: '',
})

// What the desk says when there is nothing on it: an empty reel is a
// different kind of empty from an unpicked frame, and whose matches these
// are changes who is told what to do about it.
const emptyLine = computed(() => {
  if (!props.reelEmpty) return 'Pick a frame from the reel to put a match on the desk.'
  return props.voice === 'your'
    ? 'None of the matches in this review are in your history any more.'
    : 'This bundle holds no matches to review. The player can share more from their Matches tab.'
})

const emit = defineEmits<{
  'update-note': [draft: CoachNoteDraft]
  'update-context': [context: ObservedContext]
  'update-moment': [moment: CoachMoment]
  'remove-moment': [momentId: string]
  /** A frame dropped on one moment: which one, and the file. */
  'attach-moment': [momentId: string, file: File]
  'copy-replay': []
  'remove-frame': []
  prev: []
  next: []
}>()

// Taking the match out kills its note and moments, so it is armed like
// every destructive paper action. Re-arms per frame: an armed state left
// over from another match would make the second click land on the wrong one.
const removeArmed = ref(false)
watch(() => props.record?.match_key, () => { removeArmed.value = false })

const LAST_FRAME_REASON = 'A review needs at least one match — delete the review instead.'

// The desk's order follows the voice. A coach watches a stranger's match,
// marks what they see, and only then writes the overall read — strip, then
// note. A player already knows their own match: the note ("what will you do
// differently?") is the primary act, and leading with it keeps the writing
// surface above the fold on a 720-tall window instead of behind stats they
// played through themselves.
const deskOrder = computed<readonly ('note' | 'moments')[]>(() =>
  (props.voice === 'your' ? ['note', 'moments'] : ['moments', 'note']))

function onRemoveFrame(): void {
  if (!removeArmed.value) {
    removeArmed.value = true
    return
  }
  removeArmed.value = false
  emit('remove-frame')
}
</script>

<template>
  <div class="coach-desk">
    <template v-if="record">
      <CoachMatchCard :record="record" :handle="handle" :labels="labels" :voice="voice" :omit-review-id="omitReviewId" />
      <!--
        Only for a frame the app has never seen. A bundle's match arrives
        parsed, so there is nothing for the coach to tell us about it; a
        replay's arrives blank, and the card above would read "No result ·
        Not dated · —" until somebody says otherwise. Keyed on PROVENANCE
        (a typed corpus, a coded frame) and never on the data: keying on a
        blank map made the whole form vanish, mid-task and for good, the
        moment its own map save round-tripped.
      -->
      <CoachObservedContext
        v-if="sessionDate && record.annotation?.replay_code"
        :record="record"
        :session-date="sessionDate"
        :subject-kind="subjectKind"
        @update="(ctx: ObservedContext) => emit('update-context', ctx)"
      />
      <!-- Real DOM order, not CSS order — the tab order must match what
           the eye sees. See deskOrder for why the voices differ. -->
      <template v-for="piece in deskOrder" :key="piece">
        <CoachCueStrip
          v-if="piece === 'moments'"
          :moments="moments"
          :game-length="record.data?.game_length ?? ''"
          :replay-code="record.annotation?.replay_code ?? ''"
          :blocked="blockedReason !== ''"
          :blocked-reason="blockedReason"
          :save-state-for="momentSaveState"
          @update="(m: CoachMoment) => emit('update-moment', m)"
          @remove="(id: string) => emit('remove-moment', id)"
          @copy-replay="emit('copy-replay')"
          @attach="(id: string, file: File) => emit('attach-moment', id, file)"
        />
        <CoachNoteEditor
          v-else
          :match-key="record.match_key"
          :voice="voice"
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
      <!-- App-surface buttons, not paper ones: this strip sits on the room's
           own background, where paper ink has no contrast. Blocked (a
           read-only profile) outranks the last-frame reason — the same
           precedence every sibling control uses. -->
      <div v-if="removable !== 'none'" class="desk-remove">
        <button
          type="button"
          class="btn ghost"
          :disabled="removable === 'last' || blockedReason !== ''"
          :title="blockedReason || (removable === 'last' ? LAST_FRAME_REASON : undefined)"
          @click="onRemoveFrame"
        >
          {{ removeArmed ? 'Take it out — its note and moments go with it' : 'Take this match out of the review' }}
        </button>
        <button v-if="removeArmed" type="button" class="btn ghost" @click="removeArmed = false">
          Keep it
        </button>
      </div>
    </template>
    <!--
      Two empties, and they are not the same. "Pick a frame from the reel" was
      shown for both, so the state where there is nothing to pick pointed the
      coach at an empty reel and asked them to choose from it.
    -->
    <p v-else class="desk-empty">
      {{ emptyLine }}
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

.desk-remove {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.desk-empty {
  margin: 0;
  padding: 2rem 1rem;
  font-size: var(--type-lg);
  color: var(--text-faint);
  text-align: center;
}
</style>
