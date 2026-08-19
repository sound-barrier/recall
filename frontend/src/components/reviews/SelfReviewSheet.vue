<script setup lang="ts">
import SheetFocusTally from '@/components/coach/notes/SheetFocusTally.vue'
import SheetRecord from '@/components/coach/notes/SheetRecord.vue'
import SheetSummary from '@/components/coach/notes/SheetSummary.vue'
import { SAVE_LABEL, type CoachSaveState } from '@/components/coach/room/coach-room-props'
import type { FocusCount } from '@/match/coach/coach-notes'
import { formatPlayerDay } from '@/match/coach/coach-time'
import type { WLDTally } from '@/match/match-stats-helpers'

// The sitting's sheet: its name, how the set went, what you want to work on,
// and Finish. Same paper, same record / tally / summary pieces as the coach's
// session sheet — the coach's four affordances (Reviewing X · Change player
// · Export · End) have no meaning for your own matches, so this is its own
// sheet composed from the shared parts rather than a mode on theirs.

withDefaults(defineProps<{
  title: string
  wld: WLDTally
  winRate: number | null
  focusTally: FocusCount[]
  /** "3 notes · 4 moments · 1 reviewed only" — from notesSummaryLine(). */
  notesLine: string
  summary: string
  /** Where the header (title + summary, one save) stands. */
  headerSaveState?: CoachSaveState
  /** RFC3339 when the sitting has been finished; '' while in progress. */
  finishedAt?: string
}>(), { headerSaveState: 'idle', finishedAt: '' })

const emit = defineEmits<{
  'update-title': [text: string]
  'update-summary': [text: string]
  finish: []
  close: []
}>()

function onTitleInput(e: Event): void {
  if (!(e.target instanceof HTMLInputElement)) return
  emit('update-title', e.target.value)
}
</script>

<template>
  <aside class="paper coach-sheet self-sheet" aria-label="Review sheet">
    <div class="sheet-block">
      <label class="eyebrow ink" for="self-review-title">Title</label>
      <input
        id="self-review-title"
        class="self-sheet-title"
        type="text"
        :value="title"
        maxlength="120"
        placeholder="Name this review…"
        @input="onTitleInput"
      >
      <p class="sheet-summary-status" role="status" aria-label="Title save state">
        {{ SAVE_LABEL[headerSaveState] }}
      </p>
    </div>

    <SheetRecord :wld="wld" :win-rate="winRate" label="Review record" />
    <SheetFocusTally :focus-tally="focusTally" :notes-line="notesLine" />
    <SheetSummary
      id="self-review-summary"
      :summary="summary"
      :save-state="headerSaveState"
      @update="(text: string) => emit('update-summary', text)"
    />

    <p class="sheet-persist">
      Every note lands on its match as you write it. Finishing marks these matches
      reviewed and puts the review on the shelf; you can reopen it any time.
    </p>

    <footer class="sheet-actions">
      <button type="button" class="paper-btn primary" @click="emit('finish')">
        {{ finishedAt ? 'Finish review again' : 'Finish review' }}
      </button>
      <button type="button" class="paper-btn" @click="emit('close')">
        ← All reviews
      </button>
    </footer>
    <p v-if="finishedAt" class="eyebrow ink self-sheet-finished">
      Finished · {{ formatPlayerDay(finishedAt.slice(0, 10)) }}
    </p>
  </aside>
</template>

<style scoped>
.coach-sheet {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  padding: 1rem 1.05rem 1.1rem;
}

.sheet-block {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

/* The title is set in the sheet's own display voice — the same face the
   coach sheet's "Reviewing Sable" wears — but as an input, because it is
   yours to name. */
.self-sheet-title {
  padding: 0.3rem 0.45rem;
  font-family: var(--display);
  font-style: italic;
  font-size: var(--type-7xl);
  font-weight: 800;
  line-height: 1.1;
  color: var(--ink);
  text-transform: uppercase;
  background: var(--paper-2);
  border: 1px solid var(--ink-faint);
  border-radius: var(--radius);
}

.self-sheet-title::placeholder {
  font-weight: 600;
  color: var(--ink-faint);
  text-transform: none;
}

.sheet-persist {
  margin: 0;
  font-size: var(--type-2xs);
  line-height: 1.45;
  color: var(--ink-faint);
}

.sheet-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--paper-rule);
}

.self-sheet-finished {
  margin: 0;
}
</style>
