<script setup lang="ts">
import { matchKeyLabel } from '@/match/coach/coach-time'

// The notes the session carries but cannot frame: everything ever written
// about this player re-loads on open, and a note about a match not in
// TODAY'S corpus had nowhere to appear — invisible exactly when a coach
// most wants to see what they said last time. A quiet drawer shelves
// them under the desk; the reel stays today's corpus only.

export interface OrphanNote {
  matchKey: string
  kind: string
  text: string
}

defineProps<{
  notes: OrphanNote[]
  /** "Earlier notes about Sable" / "Your earlier notes" — voice-made. */
  heading: string
}>()
</script>

<template>
  <details v-if="notes.length" class="orphan-drawer">
    <summary class="orphan-summary">
      <span class="eyebrow accent">{{ heading }}</span>
      <span class="orphan-count">{{ notes.length }} from before this corpus</span>
    </summary>
    <ul class="orphan-list">
      <li v-for="n in notes" :key="n.matchKey" class="orphan-note">
        <span class="orphan-key">{{ matchKeyLabel(n.matchKey) }}</span>
        <p class="orphan-text">
          {{ n.kind === 'reviewed_only' ? 'Reviewed — nothing to add.' : n.text }}
        </p>
      </li>
    </ul>
  </details>
</template>

<style scoped>
.orphan-drawer {
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-md);
  background: var(--surface);
}

.orphan-summary {
  display: flex;
  gap: 0.6rem;
  align-items: baseline;
  padding: 0.55rem 0.9rem;
  cursor: pointer;
  list-style: none;
}

.orphan-summary::-webkit-details-marker {
  display: none;
}

.orphan-drawer[open] .orphan-summary {
  border-bottom: 1px solid var(--border-soft);
}

.orphan-count {
  font-family: var(--mono);
  font-size: var(--type-3xs);
  color: var(--text-faint);
}

.orphan-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.orphan-note {
  display: grid;
  gap: 0.12rem;
  padding: 0.6rem 0.9rem;
  border-bottom: 1px solid var(--border-soft);
}

.orphan-note:last-child {
  border-bottom: 0;
}

.orphan-key {
  font-family: var(--mono);
  font-size: var(--type-3xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.orphan-text {
  margin: 0;
  font-size: var(--type-sm);
  color: var(--text-dim);
}
</style>
