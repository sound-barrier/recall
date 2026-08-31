<script setup lang="ts">
import type { FocusEntry } from '@/api'
import NoteProse from '@/components/coach/notes/NoteProse.vue'

// What to work on, said while you are in a session — the one moment the
// list is worth anything, because it is the only moment you can still act
// on it. Everything else about reviewing is retrospective.
//
// Three at most, in the order the server put them: a coach's items outrank
// your own, so if a coach has told you something you are reading that
// first. More than three is a reading task, and you are mid-queue.
//
// Like the tilt nudge it never auto-dismisses — advice that vanishes unseen
// is noise, advice you close is a decision — and dismissal is scoped to the
// session (useFocusNudge owns that).
defineProps<{
  items: FocusEntry[]
  visible: boolean
}>()

const emit = defineEmits<{
  dismiss: []
}>()
</script>

<template>
  <Transition name="toast">
    <aside
      v-if="visible"
      class="toast toast-notice toast-notice-stacked focus-nudge-toast"
      role="status"
      aria-live="polite"
      aria-label="What to focus on this session"
    >
      <p class="eyebrow accent focus-nudge-head">
        This session
      </p>
      <ol class="focus-nudge-list">
        <li v-for="item in items" :key="item.item_id" class="focus-nudge-item">
          <NoteProse :text="item.text" inline />
          <span v-if="item.source === 'coach'" class="focus-nudge-from">
            — {{ item.coach_name || 'your coach' }}
          </span>
        </li>
      </ol>
      <button
        type="button"
        class="toast-dismiss focus-nudge-dismiss"
        @click="emit('dismiss')"
      >
        Got it
      </button>
    </aside>
  </Transition>
</template>

<style scoped>
/* Rung: above the session tally, below the parse outcome. */
.focus-nudge-toast {
  bottom: 8.5rem;
}

.focus-nudge-head {
  margin: 0;
}

.focus-nudge-list {
  margin: 0;
  padding-left: 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.focus-nudge-from {
  color: var(--text-dim);
}

.focus-nudge-dismiss {
  align-self: flex-end;
}
</style>

<style src="@/components/shared/toasts.css"></style>
