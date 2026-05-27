<script setup lang="ts">
import { ref } from 'vue'

// Soft-delete row at the bottom of MatchCard's expanded view.
//
// Hide is destructive in user intent ("I don't want to see this
// match"), but reversible at the data layer (no rows are dropped),
// so it uses an inline two-step "Hide → Confirm / Cancel" confirm
// instead of a modal. Unhide is one-click — strictly restorative.
//
// Extracted from MatchCard so the confirm flow can be tested in
// isolation and so the danger-zone styling is scoped to the SFC
// that owns it.

const props = defineProps<{
  matchKey: string
  hidden: boolean
}>()

const emit = defineEmits<{
  'set-hidden': [matchKey: string, hidden: boolean]
}>()

const confirmingHide = ref(false)

function startHideConfirm() {
  confirmingHide.value = true
}

function cancelHideConfirm() {
  confirmingHide.value = false
}

function confirmHide() {
  confirmingHide.value = false
  emit('set-hidden', props.matchKey, true)
}

function unhide() {
  emit('set-hidden', props.matchKey, false)
}
</script>

<template>
  <div class="match-danger" role="group" aria-label="Match visibility">
    <template v-if="!hidden">
      <template v-if="!confirmingHide">
        <button
          type="button"
          class="danger-btn"
          title="Hide this match. Soft delete — the row stays in the database (a re-parse won't re-add the screenshots), and you can unhide it later via the Hidden toggle in the filter rail."
          @click="startHideConfirm"
        >
          <span class="danger-glyph" aria-hidden="true">⌫</span>
          Hide match
        </button>
      </template>
      <template v-else>
        <span class="danger-prompt">Hide this match?</span>
        <button
          type="button"
          class="danger-btn danger-confirm"
          title="Confirm. The match will disappear from the list. Reveal it again via the Hidden · N toggle in the filter rail."
          @click="confirmHide"
        >
          Confirm
        </button>
        <button
          type="button"
          class="danger-btn danger-cancel"
          title="Cancel — leave the match visible."
          @click="cancelHideConfirm"
        >
          Cancel
        </button>
      </template>
    </template>
    <template v-else>
      <span class="danger-prompt hidden-prompt">
        <span class="danger-glyph" aria-hidden="true">⌫</span>
        This match is hidden.
      </span>
      <button
        type="button"
        class="danger-btn danger-unhide"
        title="Restore this match to the list."
        @click="unhide"
      >
        Unhide
      </button>
    </template>
  </div>
</template>

<style scoped>
.match-danger {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 1rem;
  padding-top: 0.85rem;
  border-top: 1px dashed color-mix(in srgb, currentcolor 18%, transparent);
}

.danger-prompt {
  font-size: 0.8rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.danger-prompt.hidden-prompt {
  color: var(--accent);
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.danger-glyph {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.95rem;
  line-height: 1;
}

.danger-btn {
  appearance: none;
  background: transparent;
  border: 1px solid color-mix(in srgb, currentcolor 22%, transparent);
  padding: 0.3rem 0.7rem;
  font-size: 0.78rem;
  font-family: inherit;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-faint);
  cursor: pointer;
  border-radius: 2px;
  transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.danger-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.danger-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.danger-btn.danger-confirm {
  color: var(--accent);
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.danger-btn.danger-confirm:hover {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
}

.danger-btn.danger-unhide {
  color: var(--accent);
  border-color: var(--accent);
}
</style>
