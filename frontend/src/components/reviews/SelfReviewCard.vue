<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef } from 'vue'

import { useWriteGate } from '@/composables/shared/useWriteGate'
import { formatPlayerDay } from '@/match/coach/coach-time'
import { shelfCardSpokenState, type ShelfCard } from '@/match/reviews/shelf-helpers'

// One sitting on the shelf: the reel, shelved. A paper card whose header is
// the ruled-paper hatch the reel's day labels wear, and whose left edge is
// the reel's own sprocket rail at label size — one perforation per match,
// carrying the mark the full reel uses (filled: a note was written; hollow:
// only looked at; bare: nothing yet). The rail is decoration; the card's
// state line says the same thing in words.

const props = defineProps<{ card: ShelfCard }>()

const emit = defineEmits<{
  open: []
  remove: []
  'show-matches': []
}>()

// Delete is armed: the first click asks, the second does — and the asking
// happens in the BODY, so the footer never reflows under the pointer
// between the first click and the second.
const armed = ref(false)
const confirmButton = useTemplateRef<HTMLButtonElement>('confirmButton')
const { writesLocked, lockReason, guardWrite } = useWriteGate()

function onDelete(): void {
  if (!guardWrite()) return
  if (!armed.value) {
    armed.value = true
    // The footer's Delete unmounts on arming; without a hand-off the
    // keyboard lands on <body> and a screen reader hears nothing.
    void nextTick(() => confirmButton.value?.focus())
    return
  }
  armed.value = false
  emit('remove')
}

const headId = computed(() => `self-review-card-${props.card.reviewId}`)
const spoken = computed(() => shelfCardSpokenState(props.card))
const MARK_GLYPH = { written: '✎', reviewed: '✓', bare: '' } as const
const MARK_TITLE = {
  written: 'Note written',
  reviewed: 'Looked at, no note',
  bare: 'Not opened yet',
} as const
</script>

<template>
  <article class="paper self-review-card" :aria-labelledby="headId" :aria-describedby="`${headId}-state`">
    <span class="src-rail" aria-hidden="true">
      <span
        v-for="(mark, i) in card.rail"
        :key="i"
        class="src-hole"
        :title="MARK_TITLE[mark]"
      >
        <span v-if="mark !== 'bare'" class="paper-mark src-mark" :class="{ hollow: mark === 'reviewed' }">{{ MARK_GLYPH[mark] }}</span>
      </span>
    </span>
    <div class="src-body">
      <h4 :id="headId" class="src-head paper-rule-hatch">
        {{ card.title }}
      </h4>
      <p :id="`${headId}-state`" class="src-state">
        {{ formatPlayerDay(card.dayKey) }} · {{ spoken }}
      </p>
      <p v-if="card.summaryExcerpt" class="src-summary">
        {{ card.summaryExcerpt }}
      </p>
      <div v-if="armed" class="src-warn" role="alert">
        <p class="src-warn-line">
          Delete this review? Notes and moments go with it — the matches stay.
        </p>
        <div class="src-warn-actions">
          <button ref="confirmButton" type="button" class="paper-btn" @click="onDelete">
            Delete this review — notes go with it
          </button>
          <button type="button" class="paper-btn" @click="armed = false">
            Keep it
          </button>
        </div>
      </div>
      <footer class="src-foot">
        <button type="button" class="paper-btn" @click="emit('open')">
          Open →
        </button>
        <button type="button" class="paper-btn" @click="emit('show-matches')">
          Show these matches →
        </button>
        <button
          v-if="!armed"
          type="button"
          class="paper-btn"
          :disabled="writesLocked"
          :title="lockReason || undefined"
          @click="onDelete"
        >
          Delete
        </button>
      </footer>
    </div>
  </article>
</template>

<style scoped>
.self-review-card {
  display: grid;
  grid-template-columns: 1.15rem minmax(0, 1fr);
  gap: 0.5rem;
  padding: 0 0.75rem 0.75rem 0;
  overflow: hidden;
}

/* The reel's rail (CoachReelFrame.vue) at label size: the same perforation
   gradient, one hole per member, marks on top. */
.src-rail {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  align-items: center;
  padding: 0.5rem 0;
  background: repeating-linear-gradient(to bottom, var(--border-strong) 0 4px, transparent 4px 12px);
}

.src-hole {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 1rem;
}

.src-body {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  min-width: 0;
}

/* The sitting is named in the card's own display voice — the title is the
   biggest thing on the card, not a kicker smaller than its own excerpt. */
.src-head {
  margin: 0;
  padding: 0.5rem 0.75rem;
  font-family: var(--display);
  font-size: var(--type-3xl);
  font-style: italic;
  font-weight: 800;
  line-height: 1.1;
  color: var(--ink);
  text-transform: uppercase;
  border-bottom: 1px solid var(--paper-edge);
}

.src-state {
  margin: 0;
  font-size: var(--type-md);
  color: var(--ink-dim);
}

.src-summary {
  margin: 0;
  font-size: var(--type-lg);
  line-height: 1.45;
  color: var(--ink);
}

.src-warn {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.src-warn-line {
  margin: 0;
  font-size: var(--type-md);
  line-height: 1.4;
  color: var(--paper-loss);
}

.src-warn-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.src-foot {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: auto;
}
</style>
