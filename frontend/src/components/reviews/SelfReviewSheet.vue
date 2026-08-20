<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'

import SheetFocusTally from '@/components/coach/notes/SheetFocusTally.vue'
import SheetRecord from '@/components/coach/notes/SheetRecord.vue'
import SheetFocusItems from '@/components/coach/notes/SheetFocusItems.vue'
import { SAVE_LABEL, type CoachSaveState } from '@/components/coach/room/coach-room-props'
import type { FocusItem } from '@/api'
import type { FocusCount } from '@/match/coach/coach-notes'
import { formatPlayerDay } from '@/match/coach/coach-time'
import type { WLDTally } from '@/match/match-stats-helpers'

// The sitting's sheet: its name, how the set went, what you want to work on,
// and Finish. Same paper, same record / tally / focus pieces as the coach's
// session sheet — the coach's four affordances (Reviewing X · Change player
// · Export · End) have no meaning for your own matches, so this is its own
// sheet composed from the shared parts rather than a mode on theirs.
//
// The title and the focus list save under separate keys, but the sheet
// prints ONE line for both, reporting whichever is doing worse — two lines
// reading "Autosaves as you write" under one sheet say nothing the first
// did not. A read-only profile is one banner at the top, not a reason
// whispered per field.

const props = withDefaults(defineProps<{
  title: string
  wld: WLDTally
  winRate: number | null
  focusTally: FocusCount[]
  /** "3 notes · 4 moments · 1 reviewed only" — from notesSummaryLine(). */
  notesLine: string
  /** What the sitting concluded, in the player's order. */
  focusItems: FocusItem[]
  /** Where the title's save stands. */
  headerSaveState?: CoachSaveState
  /** Where the focus list's own save stands. */
  focusSaveState?: CoachSaveState
  /** RFC3339 when the sitting has been finished; '' while in progress. */
  finishedAt?: string
  /** Why writes are refused right now (a read-only profile); '' when open. */
  blockedReason?: string
}>(), { headerSaveState: 'idle', focusSaveState: 'idle', finishedAt: '', blockedReason: '' })

const emit = defineEmits<{
  'update-title': [text: string]
  'update-focus-items': [items: FocusItem[]]
  finish: []
  close: []
}>()

const titleField = useTemplateRef<HTMLInputElement>('titleField')

// Worst-first: an error the user must see outranks a save in flight, which
// outranks a save that landed.
const SAVE_RANK: CoachSaveState[] = ['error', 'saving', 'saved', 'idle']
const sheetSaveState = computed<CoachSaveState>(() =>
  SAVE_RANK.find((s) => s === props.headerSaveState || s === props.focusSaveState) ?? 'idle')

// Finish on a nameless sitting nudges once — the shelf card otherwise
// falls back to "Review of <date>", which nobody finds later. The second
// press goes through as asked; a nudge that blocks is a different feature.
const nameNudged = ref(false)
const showNameNudge = computed(() => nameNudged.value && props.title.trim() === '')

function onFinish(): void {
  if (props.title.trim() === '' && !nameNudged.value) {
    nameNudged.value = true
    titleField.value?.focus()
    return
  }
  emit('finish')
}

const finished = computed(() => props.finishedAt !== '')

// finished_at is a UTC instant; the chip speaks the VIEWER's day.
const finishedDay = computed(() => {
  const d = new Date(props.finishedAt)
  if (Number.isNaN(d.getTime())) return props.finishedAt.slice(0, 10)
  const pad = (n: number) => String(n).padStart(2, '0')
  return formatPlayerDay(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
})

function onTitleInput(e: Event): void {
  if (!(e.target instanceof HTMLInputElement)) return
  emit('update-title', e.target.value)
}
</script>

<template>
  <aside class="paper coach-sheet self-sheet" aria-label="Review sheet">
    <p v-if="blockedReason" class="self-sheet-blocked" role="status">
      {{ blockedReason }}
    </p>

    <div class="sheet-block">
      <label class="eyebrow ink" for="self-review-title">Title</label>
      <input
        id="self-review-title"
        ref="titleField"
        class="self-sheet-title"
        type="text"
        :value="title"
        maxlength="120"
        spellcheck="true"
        autocorrect="off"
        placeholder="Name this review…"
        :disabled="blockedReason !== ''"
        :aria-describedby="showNameNudge ? 'self-sheet-name-nudge' : undefined"
        @input="onTitleInput"
      >
      <p v-if="showNameNudge" id="self-sheet-name-nudge" class="self-sheet-nudge" role="status">
        Give it a name so you can find it later — or press Finish again to keep the date.
      </p>
      <p v-if="!blockedReason" class="sheet-summary-status" role="status" aria-label="Sheet save state">
        {{ SAVE_LABEL[sheetSaveState] }}
      </p>
    </div>

    <SheetRecord :wld="wld" :win-rate="winRate" label="Review record" />
    <!-- Count line only: focus tags are a coach's filing system, and the
         self note carries none, so the tally half would never fill. -->
    <SheetFocusTally :focus-tally="focusTally" :notes-line="notesLine" :show-tally="false" />
    <SheetFocusItems
      id="self-review-focus"
      :items="focusItems"
      :save-state="focusSaveState"
      :blocked-reason="blockedReason"
      :show-status="false"
      placeholder="One thing to take into your next games…"
      @update="(items: FocusItem[]) => emit('update-focus-items', items)"
    />

    <p class="sheet-persist">
      Every note lands on its match as you write it. Finishing marks these
      matches reviewed; leaving keeps everything — the review stays in Your
      reviews marked in progress.
    </p>

    <!-- In progress: Finish is the primary, on its own row, and the way out
         says where it goes. Finished: the state is a chip ABOVE the actions,
         going back is the primary, and re-finishing is the quiet edge case
         it is — not a primary that reads as "Save again". -->
    <p v-if="finished" class="eyebrow ink self-sheet-finished">
      Finished · {{ finishedDay }}
    </p>
    <footer class="sheet-actions">
      <template v-if="!finished">
        <button
          type="button"
          class="paper-btn primary self-sheet-finish"
          :disabled="blockedReason !== ''"
          :title="blockedReason || undefined"
          @click="onFinish"
        >
          Finish review
        </button>
        <button type="button" class="paper-btn" @click="emit('close')">
          ← Back to reviews
        </button>
      </template>
      <template v-else>
        <button type="button" class="paper-btn primary self-sheet-finish" @click="emit('close')">
          ← Back to reviews
        </button>
        <button
          type="button"
          class="paper-btn"
          :disabled="blockedReason !== ''"
          :title="blockedReason || 'Re-marks these matches reviewed; nothing else changes'"
          @click="onFinish"
        >
          Re-finish
        </button>
      </template>
    </footer>
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

/* The one place the read-only lock speaks on this sheet. The loss color
   because it is a refusal, not a status. */
.self-sheet-blocked {
  margin: 0;
  font-size: var(--type-md);
  line-height: 1.4;
  color: var(--paper-loss);
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

.self-sheet-nudge {
  margin: 0;
  font-size: var(--type-md);
  line-height: 1.4;
  color: var(--ink);
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

/* Finish (and its finished-state successor) owns the row. */
.self-sheet-finish {
  flex: 1 1 100%;
}

.self-sheet-finished {
  margin: 0;
}
</style>
