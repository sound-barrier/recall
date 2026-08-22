<script setup lang="ts">
import { computed, ref } from 'vue'

import { REPLAY_CODE_LENGTH, isReplayCode, toReplayCodeDraft } from '@/match/replay-code'

// Adding a replay to the reel while the review is already running.
//
// Codes arrive one at a time over voice chat — "watch A1B2C3 too" — so the
// reel has to grow mid-session rather than being fixed when it opened. Lives
// under the reel because that is what it extends.

const props = defineProps<{ add: (code: string) => void }>()

const open = ref(false)
const draft = ref('')
const ready = computed(() => isReplayCode(draft.value))

function onInput(): void {
  draft.value = toReplayCodeDraft(draft.value)
}

function submit(): void {
  if (!ready.value) return
  props.add(draft.value)
  draft.value = ''
  open.value = false
}
</script>

<template>
  <div class="coach-add-code">
    <button
      v-if="!open"
      type="button"
      class="btn ghost coach-add-code-trigger"
      @click="open = true"
    >
      Add a replay code…
    </button>
    <form v-else class="coach-add-code-form" @submit.prevent="submit">
      <label class="eyebrow" for="coach-add-code-input">Replay code</label>
      <input
        id="coach-add-code-input"
        v-model="draft"
        class="mm-input mono"
        type="text"
        :maxlength="REPLAY_CODE_LENGTH"
        autocapitalize="characters"
        autocomplete="off"
        spellcheck="false"
        placeholder="e.g. D4E5F6"
        @input="onInput"
        @keydown.escape="open = false"
      >
      <div class="coach-add-code-actions">
        <button type="submit" class="btn ghost" :disabled="!ready">
          Add
        </button>
        <button type="button" class="btn ghost" @click="open = false">
          Cancel
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.coach-add-code {
  padding: var(--space-2);
  border-top: 1px solid var(--hairline);
}

.coach-add-code-trigger {
  width: 100%;
}

.coach-add-code-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.coach-add-code-actions {
  display: flex;
  gap: var(--space-1);
}
</style>
