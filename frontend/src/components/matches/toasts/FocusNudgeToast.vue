<script setup lang="ts">
import type { FocusEntry } from '@/api'

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
  <Transition name="focus-nudge">
    <aside
      v-if="visible"
      class="focus-nudge-toast"
      role="status"
      aria-live="polite"
      aria-label="What to focus on this session"
    >
      <p class="eyebrow accent focus-nudge-head">
        This session
      </p>
      <ol class="focus-nudge-list">
        <li v-for="item in items" :key="item.item_id" class="focus-nudge-item">
          {{ item.text }}
          <span v-if="item.source === 'coach'" class="focus-nudge-from">
            — {{ item.coach_name || 'your coach' }}
          </span>
        </li>
      </ol>
      <button
        type="button"
        class="focus-nudge-dismiss"
        @click="emit('dismiss')"
      >
        Got it
      </button>
    </aside>
  </Transition>
</template>

<style scoped>
/* The bottom-right toast ladder, from the floor up: the tilt nudge at
   1rem, the session tally at 4.5rem, this at 8.5rem, the parse-outcome
   report at 13rem. All four fire off the same completed parse, so
   sharing a rung is not a rare collision — it is the normal case, and
   the tilt nudge (rendered later at the same z-index) would have
   covered this one outright. */
.focus-nudge-toast {
  position: fixed;
  right: 1rem;
  bottom: 8.5rem;
  z-index: 1200;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  align-items: flex-start;
  max-width: min(420px, 92vw);
  padding: 0.7rem 0.85rem;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-left: 3px solid var(--accent);
  border-radius: var(--radius-md);
  box-shadow: 0 12px 32px color-mix(in srgb, var(--bg) 55%, transparent);
  font-size: var(--type-md);
  color: var(--text);
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
  appearance: none;
  align-self: flex-end;
  font-family: var(--mono);
  font-size: var(--type-2xs);
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  padding: 0.3rem 0.6rem;
  background: transparent;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  color: var(--text);
  cursor: pointer;
  transition: color var(--duration-fast) ease, border-color var(--duration-fast) ease;
}

.focus-nudge-dismiss:hover,
.focus-nudge-dismiss:focus-visible {
  border-color: var(--accent);
  color: var(--accent-text);
}

.focus-nudge-enter-active,
.focus-nudge-leave-active {
  transition: opacity var(--duration-prompt) ease, transform var(--duration-prompt) ease;
}

.focus-nudge-enter-from,
.focus-nudge-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
