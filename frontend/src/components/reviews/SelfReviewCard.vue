<script setup lang="ts">
import { computed, ref } from 'vue'

import { useWriteGate } from '@/composables/shared/useWriteGate'
import { formatPlayerDay } from '@/match/coach/coach-time'
import { shelfCardSpokenState, type ShelfCard } from '@/match/reviews/shelf-helpers'

// One sitting on the shelf: the reel, shelved. A paper card whose header is
// the ruled-paper hatch the reel's day labels wear, and whose left edge is
// the reel's own sprocket rail at label size — one perforation per match,
// carrying the mark the full reel uses (filled: a note was written; hollow:
// only looked at; bare: nothing yet). The rail is decoration; the card's
// accessible name says the same thing in words.

const props = defineProps<{ card: ShelfCard }>()

const emit = defineEmits<{
  open: []
  remove: []
}>()

// Delete is armed: the first click asks, the second does. Local to the
// card — the arming belongs to the button the player is looking at.
const armed = ref(false)
const { writesLocked, lockReason, guardWrite } = useWriteGate()

function onDelete(): void {
  if (!guardWrite()) return
  if (!armed.value) {
    armed.value = true
    return
  }
  armed.value = false
  emit('remove')
}

const headId = computed(() => `self-review-card-${props.card.reviewId}`)
const spoken = computed(() => shelfCardSpokenState(props.card))
const MARK_GLYPH = { written: '✎', reviewed: '✓', bare: '' } as const
</script>

<template>
  <article class="paper self-review-card" :aria-labelledby="headId" :aria-describedby="`${headId}-state`">
    <span class="src-rail" aria-hidden="true">
      <span
        v-for="(mark, i) in card.rail"
        :key="i"
        class="src-hole"
      >
        <span v-if="mark !== 'bare'" class="paper-mark" :class="{ hollow: mark === 'reviewed' }">{{ MARK_GLYPH[mark] }}</span>
      </span>
    </span>
    <div class="src-body">
      <h4 :id="headId" class="eyebrow ink src-head paper-rule-hatch">
        {{ card.title }}
      </h4>
      <p :id="`${headId}-state`" class="src-state">
        {{ formatPlayerDay(card.dayKey) }} · {{ spoken }}
      </p>
      <p v-if="card.summaryExcerpt" class="src-summary">
        {{ card.summaryExcerpt }}
      </p>
      <footer class="src-foot">
        <button type="button" class="paper-btn primary" @click="emit('open')">
          Open →
        </button>
        <button
          type="button"
          class="paper-btn"
          :disabled="writesLocked"
          :title="lockReason || undefined"
          @click="onDelete"
        >
          {{ armed ? 'Delete this review — notes go with it' : 'Delete' }}
        </button>
        <button v-if="armed" type="button" class="paper-btn" @click="armed = false">
          Keep it
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

.src-head {
  margin: 0;
  padding: 0.5rem 0.75rem;
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

.src-foot {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: auto;
}
</style>
