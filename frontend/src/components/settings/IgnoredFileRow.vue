<script setup lang="ts">
import type { IgnoredScreenshot } from '@/api-client'
import { formatIgnoredAt } from '@/match/match-time-helpers'

// One row of the ignored-files (suppress-list) panel: a hover-preview thumbnail,
// the filename + ignored-at timestamp, and a Restore button. Presentational —
// the panel owns the hover-thumb state + the restore/lightbox actions; this row
// forwards the cursor events (so the panel can position the floating preview)
// and the click intents.
defineProps<{
  screenshot: IgnoredScreenshot
  thumbnailUrl: string
}>()

const emit = defineEmits<{
  'hover-enter': [event: MouseEvent]
  'hover-move': [event: MouseEvent]
  'hover-leave': []
  'thumb-click': []
  restore: []
}>()
</script>

<template>
  <li
    class="ignored-row"
    @mouseenter="(e) => emit('hover-enter', e)"
    @mousemove="(e) => emit('hover-move', e)"
    @mouseleave="emit('hover-leave')"
  >
    <button
      type="button"
      class="ignored-thumb-btn"
      :aria-label="`Open ${screenshot.filename} in fullscreen lightbox`"
      @click="emit('thumb-click')"
    >
      <img
        :src="thumbnailUrl"
        :alt="screenshot.filename"
        class="ignored-thumb"
        loading="lazy"
      >
    </button>
    <div class="ignored-meta">
      <div class="ignored-filename mono">
        {{ screenshot.filename }}
      </div>
      <div class="ignored-timestamp">
        {{ formatIgnoredAt(screenshot.ignored_at) }}
      </div>
    </div>
    <button
      type="button"
      class="btn primary ignored-restore"
      @click="emit('restore')"
    >
      Restore
    </button>
  </li>
</template>

<style scoped>
.ignored-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.85rem;
  padding: 0.55rem 0.5rem;
  border-bottom: 1px solid var(--border-soft, var(--border));
}

.ignored-row:last-child {
  border-bottom: none;
}

.ignored-thumb-btn {
  appearance: none;
  width: 96px;
  height: 54px;
  padding: 0;
  flex-shrink: 0;
  overflow: hidden;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 2px;
  cursor: pointer;
  transition: border-color var(--duration-fast) ease, transform var(--duration-fast) ease;
}

.ignored-thumb-btn:hover,
.ignored-thumb-btn:focus-visible {
  border-color: var(--accent);
  outline: none;
  transform: scale(1.02);
}

.ignored-thumb {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ignored-meta {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.ignored-filename {
  font-size: 0.82rem;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ignored-timestamp {
  font-size: 0.72rem;
  color: var(--text-faint);
}

.ignored-restore {
  flex-shrink: 0;
}

@media (prefers-reduced-motion: reduce) {
  .ignored-thumb-btn {
    transition: none;
  }

  .ignored-thumb-btn:hover,
  .ignored-thumb-btn:focus-visible {
    transform: none;
  }
}
</style>
