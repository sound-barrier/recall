<script setup lang="ts">
// Smart-empty filter suggestions — surfaced when the user's narrow
// excludes every record. Renders the top 1-2 "Try removing X" cards
// from the suggestions array; clicking one calls that clause's
// clear() so the narrow contracts in a single action.
//
// Picker policy: the parent (MatchesView) decides cardinality and
// passes the pre-trimmed array. This component is pure render.

interface Suggestion {
  clauseId: string
  label: string
  wouldSurface: number
  clear: () => void
}

defineProps<{
  suggestions: Suggestion[]
}>()
</script>

<template>
  <div v-if="suggestions.length > 0" class="empty-suggestions">
    <p class="empty-suggestions-eyebrow">
      Try removing one filter to see more matches
    </p>
    <ul class="empty-suggestions-list">
      <li v-for="s in suggestions" :key="s.clauseId" class="empty-suggestion">
        <button
          type="button"
          class="empty-suggestion-btn"
          :data-clause-id="s.clauseId"
          :aria-label="`Remove ${s.label} — would surface ${s.wouldSurface} ${s.wouldSurface === 1 ? 'match' : 'matches'}`"
          @click="s.clear"
        >
          <span class="empty-suggestion-action" aria-hidden="true">Remove {{ s.label }}</span>
          <span class="empty-suggestion-count" aria-hidden="true">→ {{ s.wouldSurface }} matches</span>
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.empty-suggestions {
  margin-top: 1.5rem;
  text-align: center;
}

.empty-suggestions-eyebrow {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
  margin: 0 0 0.6rem;
}

.empty-suggestions-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: inline-flex;
  flex-direction: column;
  gap: 0.4rem;
  align-items: stretch;
}

.empty-suggestion-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.2rem;
  padding: 0.55rem 0.85rem;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 2px;
  font-family: var(--mono);
  font-size: 0.72rem;
  letter-spacing: 0.04em;
  color: var(--text);
  cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease, color 120ms ease;
}

.empty-suggestion-btn:hover,
.empty-suggestion-btn:focus-visible {
  background: color-mix(in srgb, var(--accent) 8%, var(--surface-2));
  border-color: var(--accent);
  color: var(--accent);
  outline: none;
}

.empty-suggestion-count {
  font-weight: 700;
  color: var(--accent);
}
</style>
