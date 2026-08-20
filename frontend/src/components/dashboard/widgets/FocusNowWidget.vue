<script setup lang="ts">
// What you're working on, on the dossier — the same three the session
// nudge says, in the same order the server put them (a coach's items
// outrank your own).
//
// Opt-in only: it is registered but not in DEFAULT_ROW_LAYOUT, which is
// what keeps `GET /focus` off the boot path for everyone who has not
// asked for it. Once added it reads with the rest of the tab.
//
// It does not read the dossier at all — the list is server state about the
// PLAYER, not an aggregation over the narrowed set, so narrowing to last
// Tuesday's Ana games must not change what you are working on.
import { computed } from 'vue'

import { activeFocus } from '@/match/reviews/focus-items'
import { useFocusQuery } from '@/queries/focus'

const query = useFocusQuery(true)
const items = computed(() => activeFocus(query.data.value ?? []).slice(0, 3))
</script>

<template>
  <header class="breakdown-head">
    <span class="eyebrow accent breakdown-eyebrow">What you're working on</span>
  </header>
  <ol v-if="items.length" class="focus-now-list">
    <li v-for="item in items" :key="item.item_id" class="focus-now-item">
      <span class="focus-now-text">{{ item.text }}</span>
      <span class="focus-now-from">{{ item.source === 'coach' ? (item.coach_name || 'your coach') : 'you' }}</span>
    </li>
  </ol>
  <p v-else class="focus-now-empty">
    Nothing yet — finish a review, or open a coach's notes.
  </p>
</template>

<style scoped>
.focus-now-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.focus-now-item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
}

.focus-now-text {
  min-width: 0;
}

.focus-now-from {
  flex: none;
  font-family: var(--mono);
  font-size: var(--type-2xs);
  letter-spacing: 0.08em;
  color: var(--text-faint);
}

.focus-now-empty {
  margin: 0.3rem 0 0;
  font-size: var(--type-sm);
  color: var(--text-dim);
}
</style>
