<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef } from 'vue'

import { SetFocusItemStatus, type FocusEntry } from '@/api-client'
import { formatPlayerDay } from '@/match/coach/coach-time'
import { activeFocus, retiredFocus } from '@/match/reviews/focus-items'
import { invalidateFocus } from '@/queries/focus'
import { useAppStore } from '@/stores/app'

// "What you're working on" — the one place the player's whole list lives,
// at the top of 07 where both halves of the review cycle land.
//
// Two moves, and deliberately not a third. Accept acknowledges a coach's
// item (new → working); "Got this" retires either kind (→ done). There is
// no deny and no delete: an item a coach sent is live the moment it arrives,
// so the player's choice is when to say they have read it, not whether to
// let it in. A player can disagree with their coach — they still have to
// hear it.

const props = defineProps<{
  entries: readonly FocusEntry[]
  /** Why writes are refused right now (a read-only profile); '' when open. */
  blockedReason?: string
}>()

const appStore = useAppStore()
const showRetired = ref(false)
const active = computed(() => activeFocus(props.entries))
const retired = computed(() => retiredFocus(props.entries))
const blocked = computed(() => (props.blockedReason ?? '') !== '')

// A coach's item that has not been acknowledged yet. Their own items are
// born working, so this is only ever a coach's.
const isNew = (e: FocusEntry): boolean => e.status === 'new'

function provenance(e: FocusEntry): string {
  const who = e.source === 'coach' ? (e.coach_name || 'your coach') : 'you'
  return `${who} · ${formatPlayerDay(e.from)}`
}

const bandHead = useTemplateRef<HTMLElement>('bandHead')

/**
 * Both moves destroy the control that was pressed: Accept unmounts itself
 * (the row is no longer `new`) and "Got this" takes the whole row out of
 * the live list. A button that vanishes under the finger leaves focus on
 * `<body>`, so the next Tab restarts from the top of the document.
 *
 * Focus goes to the band's own heading rather than a guessed neighbor:
 * the row that would have been "next" may itself have just moved, and the
 * heading is the one thing on this surface that is always still there.
 */
function restoreFocus(): void {
  void nextTick(() => bandHead.value?.focus())
}

async function move(e: FocusEntry, status: 'working' | 'done'): Promise<void> {
  if (blocked.value) return
  try {
    await SetFocusItemStatus(e.item_id, status)
    await invalidateFocus()
    restoreFocus()
  } catch (err) {
    appStore.setErrorFromRaw(String(err))
  }
}
</script>

<template>
  <section class="paper focus-band" aria-labelledby="focus-band-head">
    <h3 id="focus-band-head" ref="bandHead" class="focus-band-head paper-rule-hatch" tabindex="-1">
      What you're working on
    </h3>

    <p v-if="!active.length && !retired.length" class="focus-band-empty">
      Nothing yet. Finish a review, or open a coach's notes, and what to work
      on shows up here.
    </p>

    <ol v-if="active.length" class="focus-band-list">
      <li v-for="e in active" :key="e.item_id" class="focus-band-row">
        <div class="focus-band-text">
          <p class="focus-band-line">
            {{ e.text }}
          </p>
          <p class="focus-band-from">
            {{ provenance(e) }}<template v-if="isNew(e)">
              · new
            </template>
          </p>
        </div>
        <div class="focus-band-actions">
          <button
            v-if="isNew(e)"
            type="button"
            class="paper-btn"
            :disabled="blocked"
            :title="blockedReason || undefined"
            :aria-label="`Accept: ${e.text}`"
            @click="move(e, 'working')"
          >
            Accept
          </button>
          <button
            type="button"
            class="paper-chip"
            :disabled="blocked"
            :title="blockedReason || undefined"
            :aria-label="`Got this: ${e.text}`"
            @click="move(e, 'done')"
          >
            Got this
          </button>
        </div>
      </li>
    </ol>

    <div v-if="retired.length" class="focus-band-retired">
      <button type="button" class="paper-chip" :aria-expanded="showRetired" @click="showRetired = !showRetired">
        {{ showRetired ? 'Hide' : 'Show' }} {{ retired.length }} you've got
      </button>
      <ul v-if="showRetired" class="focus-band-list focus-band-done">
        <li v-for="e in retired" :key="e.item_id" class="focus-band-row">
          <div class="focus-band-text">
            <p class="focus-band-line">
              {{ e.text }}
            </p>
            <p class="focus-band-from">
              {{ provenance(e) }}
            </p>
          </div>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.focus-band {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

/* The paper card's own head, not a one-off: same display face, same
   weight, same uppercase, so the band reads as another sheet on the
   pile rather than a heading level nothing else uses. */
.focus-band-head {
  margin: 0;
  padding-bottom: 0.35rem;
  font-family: var(--display);
  font-size: var(--type-3xl);
  font-style: italic;
  font-weight: 800;
  line-height: 1.1;
  color: var(--ink);
  text-transform: uppercase;
}

.focus-band-empty {
  margin: 0;
  color: var(--ink-dim);
}

.focus-band-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.focus-band-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.6rem;
}

.focus-band-text {
  min-width: 0;
}

.focus-band-line {
  margin: 0;
  color: var(--ink);
}

.focus-band-from {
  margin: 0.1rem 0 0;
  font-size: var(--type-sm);
  color: var(--ink-faint);
}

.focus-band-actions {
  flex: none;
  display: flex;
  gap: 0.3rem;
}

.focus-band-done .focus-band-line {
  color: var(--ink-dim);
  text-decoration: line-through;
}

.focus-band-retired {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  align-items: flex-start;
}
</style>
