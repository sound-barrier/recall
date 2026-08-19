<script setup lang="ts">
import { SAVE_LABEL, type CoachSaveState } from '@/components/coach/room/coach-room-props'

// The sheet's one set-level paragraph — "what to work on" — with the save
// state under it. The box autosaves exactly as a note does; it says so, so
// the one place a reviewer writes their takeaway is not the one surface
// with no sign the words landed.
withDefaults(defineProps<{
  id: string
  summary: string
  saveState?: CoachSaveState
  /** Non-empty when the summary cannot be saved yet — the box refuses typing rather than lose a paragraph. */
  blockedReason?: string
  label?: string
  placeholder?: string
  /**
   * Whether to print the save-state line. The coach sheet's summary saves
   * under its own key, so its line is honest; the self sheet's summary
   * shares ONE header save with the title, whose line already speaks.
   */
  showStatus?: boolean
}>(), {
  saveState: 'idle', blockedReason: '', label: 'What to work on',
  placeholder: 'The one thing to take into the next session…',
  showStatus: true,
})

const emit = defineEmits<{ update: [text: string] }>()

function onInput(e: Event): void {
  if (!(e.target instanceof HTMLTextAreaElement)) return
  emit('update', e.target.value)
}
</script>

<template>
  <div class="sheet-block">
    <label class="eyebrow ink" :for="id">{{ label }}</label>
    <textarea
      :id="id"
      class="sheet-summary"
      rows="5"
      :value="summary"
      :disabled="blockedReason !== ''"
      :title="blockedReason || undefined"
      :placeholder="placeholder"
      @input="onInput"
    />
    <p v-if="showStatus" class="sheet-summary-status" role="status" aria-label="Summary save state">
      {{ blockedReason || SAVE_LABEL[saveState] }}
    </p>
  </div>
</template>

<style scoped>
.sheet-block {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.sheet-summary {
  padding: 0.5rem 0.6rem;
  font-family: var(--body);
  font-size: var(--type-lg);
  line-height: 1.5;
  color: var(--ink);
  background: var(--paper-2);
  border: 1px solid var(--ink-faint);
  border-radius: var(--radius);
  resize: vertical;
}
</style>
