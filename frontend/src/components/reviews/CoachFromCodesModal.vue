<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { REPLAY_CODE_LENGTH, isReplayCode, toReplayCodeDraft } from '@/match/replay-code'
import { useModalFocusTrap } from '@/composables/shared/keyboard/useModalFocusTrap'
import { useCoachStore } from '@/stores/coach'

// Starting a review from replay codes.
//
// The bundle flow asks a player to export their history and hand over a zip.
// This one asks for the six characters a coach was given in chat, which is
// how most reviews actually start.
//
// The codes are echoed back as chips on purpose. A replay code is now an
// identity — a match key is minted from it — so a typo no longer produces a
// cosmetic wrong string, it produces a match on the player's side that
// nobody can find. Seeing A1B2C3 written back is the cheapest place to catch
// that, and the only place before the handoff.

const coach = useCoachStore()
const open = defineModel<boolean>({ required: true })

const draft = ref('')
const codes = ref<string[]>([])
const busy = ref(false)

watch(open, (isOpen) => {
  if (!isOpen) return
  draft.value = ''
  codes.value = []
  busy.value = false
}, { immediate: true })

const ready = computed(() => isReplayCode(draft.value))
const canOpen = computed(() => !busy.value && codes.value.length > 0)

function onInput(): void {
  draft.value = toReplayCodeDraft(draft.value)
}

function addCode(): void {
  const code = draft.value
  if (!isReplayCode(code)) return
  if (!codes.value.includes(code)) codes.value = [...codes.value, code]
  draft.value = ''
}

function removeCode(code: string): void {
  codes.value = codes.value.filter((c) => c !== code)
}

async function startReview(): Promise<void> {
  if (!canOpen.value) return
  busy.value = true
  await coach.openFromReplayCodes(codes.value)
  busy.value = false
  open.value = false
}

useModalFocusTrap(open, {
  containerSelector: '.coach-codes-box',
  onClose: () => { open.value = false },
  keepOpenOnFieldEscape: true,
})
</script>

<template>
  <div
    v-if="open"
    class="sheet-overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="coach-codes-title"
    data-testid="coach-from-codes"
  >
    <div class="sheet-backdrop" aria-hidden="true" @click="open = false" />
    <form class="sheet-box coach-codes-box" @submit.prevent="startReview">
      <p class="eyebrow accent sheet-fixed">
        Coaching
      </p>
      <h2 id="coach-codes-title" class="sheet-fixed coach-codes-title">
        Use a replay code
      </h2>
      <p class="sheet-lede">
        Add the codes you were given. Recall can't show anything from a code —
        you'll watch each replay in Overwatch and fill in what you saw
        yourself — then hand back a file, or a single page, for the player
        to read.
      </p>

      <label class="eyebrow coach-codes-label" for="coach-code-input">Replay code</label>
      <p class="sheet-note coach-codes-check">
        Double-check each code: it's how the player's Recall finds the match.
      </p>
      <div class="coach-codes-entry">
        <input
          id="coach-code-input"
          v-model="draft"
          class="mm-input mono"
          type="text"
          :maxlength="REPLAY_CODE_LENGTH"
          autocapitalize="characters"
          autocomplete="off"
          spellcheck="false"
          placeholder="e.g. A1B2C3"
          @input="onInput"
          @keydown.enter.prevent="addCode"
        >
        <button type="button" class="btn ghost" :disabled="!ready" @click="addCode">
          Add
        </button>
      </div>

      <ul v-if="codes.length" class="coach-codes-list" aria-label="Replay codes to review">
        <li v-for="code in codes" :key="code" class="coach-code-chip">
          <span class="mono">{{ code }}</span>
          <button
            type="button"
            class="coach-code-remove"
            :aria-label="`Remove ${code}`"
            @click="removeCode(code)"
          >
            ×
          </button>
        </li>
      </ul>
      <p v-else class="sheet-note">
        Add at least one code to start — more can join while the review is
        under way.
      </p>

      <div class="sheet-actions">
        <button type="button" class="btn ghost" @click="open = false">
          Cancel
        </button>
        <button type="submit" class="btn primary" :disabled="!canOpen">
          Start review
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
/* The send dialog's grammar — same width cap, same display title — so the
   tab's two sibling dialogs read as one product. */
.coach-codes-box {
  width: min(32rem, 100%);
}

.coach-codes-title {
  margin: 0.2rem 0 0;
  font-family: var(--display);
  font-size: var(--type-7xl);
  font-style: italic;
  font-weight: 800;
  line-height: 1;
  color: var(--text);
  text-transform: uppercase;
}

.coach-codes-check {
  margin: 0.15rem 0 0.35rem;
}

.coach-codes-label {
  display: block;
  margin-bottom: var(--space-1);
}

.coach-codes-entry {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}

.coach-codes-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: var(--space-3) 0 0;
  padding: 0;
  list-style: none;
}

.coach-code-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 0.16rem 0.4rem;
  border: 1px solid var(--accent-soft);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--accent) 10%, var(--surface));
  color: var(--accent-text);
  font-size: var(--type-2xs);
}

.coach-code-remove {
  appearance: none;
  border: 0;

  /* A padded hit area: removing a mistyped code is the exact correction
     this dialog exists for, and a bare glyph made it a precision click. */
  padding: 0.25rem 0.45rem;
  margin: -0.25rem -0.3rem -0.25rem -0.15rem;
  background: none;
  color: inherit;
  cursor: pointer;
  font-size: var(--type-xs);
  line-height: 1;
}

.coach-code-remove:hover {
  color: var(--text);
}
</style>
