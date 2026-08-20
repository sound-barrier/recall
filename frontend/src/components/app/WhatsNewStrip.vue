<script setup lang="ts">
import { computed } from 'vue'

import { useWhatsNew } from '@/composables/app/useWhatsNew'
import { useAppStore } from '@/stores/app'

// The one-time pointer at the Reviews tab, for installs that predate it —
// the tour is first-run only, so an existing user's only clue was a new
// number in the masthead. One sentence, one action, gone once used.

const appStore = useAppStore()
const { unseen, markSeen } = useWhatsNew('reviewsTab')

const visible = computed(() => unseen())

function showMe(): void {
  markSeen()
  void appStore.goToView('reviews')
}
</script>

<template>
  <div v-if="visible" class="whats-new" role="region" aria-label="What's new">
    <span class="eyebrow accent">New</span>
    <span class="whats-new-line">
      <strong>07 Reviews</strong> — review your own matches the way a coach
      would, share sets with a coach, and read what comes back.
    </span>
    <button type="button" class="btn ghost whats-new-btn" @click="showMe">
      Show me
    </button>
    <button type="button" class="btn ghost whats-new-btn" @click="markSeen">
      Not now
    </button>
  </div>
</template>

<style scoped>
.whats-new {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.55rem;
  padding: 0.5rem 0.75rem;
  margin: 0 0 var(--space-3);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  border-radius: var(--radius);
}

.whats-new-line {
  flex: 1 1 auto;
  font-size: var(--type-lg);
  color: var(--text);
}

.whats-new-btn {
  padding: 0.25rem 0.6rem;
  font-size: var(--type-2xs);
}
</style>
