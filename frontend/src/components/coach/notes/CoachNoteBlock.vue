<script setup lang="ts">
import { computed, ref } from 'vue'

import NoteProse from '@/components/coach/notes/NoteProse.vue'
import { useWriteGate } from '@/composables/shared/useWriteGate'
import { focusTagLabel } from '@/match/coach/coach-notes'
import type { NoteBlockView } from '@/match/coach/note-block-view'
import { useAppStore } from '@/stores/app'
import { useCoachReturnsStore } from '@/stores/coachReturns'
import { useSelfReviewStore } from '@/stores/selfReview'
import { useUiStore } from '@/stores/ui'

// One note block on the match it is about: an accepted coach's note (the
// coach-RECEIVED layer) or the player's own from one of their review
// sittings. Either sits BESIDE the player's journal entry and never merges
// into it — a coach speaks in their own block, signed and dated, and a
// sitting is its own voice too. Blocks accumulate, one per coach and
// session / one per sitting, and the player can drop any of them.
//
// What the block SAYS comes in as a view (note-block-view.ts) — the two
// families differ only in attribution and in what removing one means, and
// the builders there are where each word comes from.
const props = withDefaults(defineProps<{
  matchKey: string
  block: NoteBlockView
  /** The player's replay code for this match — '' when they never entered one. */
  replayCode?: string
}>(), { replayCode: '' })

const emit = defineEmits<{ 'copy-replay': [] }>()

const appStore = useAppStore()
const returns = useCoachReturnsStore()
const selfReview = useSelfReviewStore()
const ui = useUiStore()

// Dropping a block is a write on the player's own database, so it obeys the
// same gate as the journal it sits in. The button disables with the reason,
// and the guard is what refuses a click that arrives anyway.
const { writesLocked, lockReason, guardWrite } = useWriteGate()

const tags = computed(() => props.block.tags)
const moments = computed(() => props.block.moments)

// Removing a note takes its moments with it — armed like every other
// destructive paper action: the first click asks with the cost in the
// label, the second does.
const armed = ref(false)

function remove() {
  if (!guardWrite()) return
  if (!armed.value) {
    armed.value = true
    return
  }
  armed.value = false
  const removal = props.block.removal
  if (removal.kind === 'coach') {
    void returns.removeCoachNote(props.matchKey, removal.id)
  } else {
    void selfReview.removeNoteFromSitting(removal.reviewId, props.matchKey)
  }
}

// The signature names the sitting; when the block is yours it is also the
// way back into it.
function reopenSitting() {
  const id = props.block.reopenReviewId
  if (!id) return
  // The block lives in the detail panel; a modal left open over the room
  // would trap focus on a surface the player just left.
  ui.selection.close()
  void selfReview.openSitting(id).then(() => appStore.goToView('reviews'))
}
</script>

<template>
  <section
    class="paper coach-note-block"
    role="region"
    :aria-label="block.heading"
  >
    <header class="cnb-head">
      <span class="eyebrow ink">{{ block.heading }}</span>
      <span class="paper-chip cnb-reviewed">{{ block.status }}</span>
    </header>

    <NoteProse v-if="block.text" class="cnb-text" :text="block.text" />
    <p v-else-if="!moments.length" class="cnb-text is-mark">
      Reviewed — nothing to add.
    </p>

    <p v-if="block.matchClock" class="cnb-clock">
      {{ block.matchClock }}
    </p>

    <!--
      The coach's timestamped moments, in the order they wrote them — down the
      match. Read-only here: this is the player's copy of someone else's
      review, and the replay code beside each one is what makes a timestamp
      something they can act on rather than trivia.
    -->
    <ol v-if="moments.length" class="cnb-moments">
      <li v-for="moment in moments" :key="moment.moment_id" class="cnb-moment">
        <span class="cnb-moment-clock">{{ moment.match_clock }}</span>
        <span class="cnb-moment-body">
          <span v-if="moment.focus_tag" class="paper-chip cnb-moment-tag">
            {{ focusTagLabel(moment.focus_tag) }}
          </span>
          <NoteProse :text="moment.text" inline />
        </span>
      </li>
    </ol>
    <p v-if="moments.length && replayCode" class="cnb-replay">
      <span class="cnb-replay-code">replay {{ replayCode }}</span>
      <button
        type="button"
        class="paper-chip"
        aria-label="Copy replay code to watch these moments"
        @click="emit('copy-replay')"
      >
        Copy
      </button>
    </p>

    <ul v-if="tags.length" class="cnb-tags">
      <li v-for="tag in tags" :key="tag" class="paper-chip">
        {{ focusTagLabel(tag) }}
      </li>
    </ul>

    <footer class="cnb-foot">
      <button
        v-if="block.reopenReviewId"
        type="button"
        class="cnb-sign cnb-sign-link"
        @click="reopenSitting"
      >
        {{ block.sign }}
      </button>
      <span v-else class="cnb-sign">{{ block.sign }}</span>
      <span class="cnb-foot-actions">
        <button
          type="button"
          class="paper-btn cnb-remove"
          :disabled="writesLocked"
          :title="lockReason || undefined"
          @click="remove"
        >
          {{ armed ? block.armedRemoveLabel : block.removeLabel }}
        </button>
        <button
          v-if="armed"
          type="button"
          class="paper-btn cnb-remove"
          @click="armed = false"
        >
          Keep it
        </button>
      </span>
    </footer>
  </section>
</template>

<style scoped src="./coach-note-block.css"></style>
