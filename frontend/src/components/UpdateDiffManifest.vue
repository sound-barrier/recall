<script setup lang="ts">
import type { DiffRow } from '../composables/useGameDataUpdate'

// The game-data diff surface in the update-check modal: the NEW/RETIRED
// counts headline + the flat per-name manifest (Hero/Map/Source × ±).
// Extracted from UpdateCheckModal so the modal sheds this distinct block +
// its scoped CSS; the parent computes the rows via useGameDataUpdate and
// flips `applied` to the "applied" styling once the update lands.
defineProps<{
  changeCount: number
  addedCount: number
  removedCount: number
  diffRows: DiffRow[]
  applied: boolean
}>()
</script>

<template>
  <!-- Counts headline — display font; the modal's hero
                   element after the redesign. -->
  <p
    v-if="changeCount > 0"
    class="update-check-modal-counts"
    :class="{ 'update-check-modal-counts-applied': applied }"
    data-update-check-counts
  >
    <span v-if="addedCount > 0" class="update-check-modal-counts-added">
      {{ addedCount }} NEW
    </span>
    <span v-if="addedCount > 0 && removedCount > 0" class="update-check-modal-counts-sep">·</span>
    <span v-if="removedCount > 0" class="update-check-modal-counts-removed">
      {{ removedCount }} RETIRED
    </span>
  </p>

  <!-- Diff manifest. -->
  <ul
    v-if="changeCount > 0"
    class="update-check-modal-manifest"
    :class="{ 'update-check-modal-manifest-applied': applied }"
    data-update-check-manifest
  >
    <li
      v-for="row in diffRows"
      :key="`${row.kind}-${row.sign}-${row.name}`"
      class="update-check-modal-manifest-row"
      :class="{
        'update-check-modal-manifest-row-added': row.sign === '+',
        'update-check-modal-manifest-row-removed': row.sign === '−',
      }"
    >
      <span class="update-check-modal-manifest-kind">{{ row.kind }}</span>
      <span class="update-check-modal-manifest-sign" aria-hidden="true">{{ row.sign }}</span>
      <span class="update-check-modal-manifest-name">{{ row.name }}</span>
    </li>
  </ul>
</template>

<style scoped>
.update-check-modal-counts {
  font-family: var(--display);
  font-size: 1.85rem;
  font-weight: 400;
  letter-spacing: 0.06em;
  margin: 0.2rem 0 0.65rem;
  display: flex;
  align-items: baseline;
  gap: 0.55rem;
  line-height: 1.05;
  transition: opacity 280ms ease;
}

.update-check-modal-counts-added {
  color: var(--win, #4ade80);
}

.update-check-modal-counts-removed {
  color: var(--loss);
}

.update-check-modal-counts-sep {
  color: var(--text-dim);
}

.update-check-modal-counts-applied {
  opacity: 0.55;
}

.update-check-modal-manifest {
  list-style: none;
  margin: 0 0 0.6rem;
  padding: 0;
  display: grid;
  grid-template-columns: max-content max-content 1fr;
  gap: 0.18rem 0.7rem;
  transition: opacity 280ms ease;
}

.update-check-modal-manifest-applied {
  opacity: 0.55;
}

.update-check-modal-manifest-row {
  display: contents;
}

.update-check-modal-manifest-kind {
  font-family: var(--mono);
  font-size: 0.55rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--accent);
  align-self: center;
  padding: 0.1rem 0.4rem;
  border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  border-radius: 2px;
  background: color-mix(in srgb, var(--accent) 4%, transparent);
  text-align: center;
  min-width: 3.6em;
}

.update-check-modal-manifest-sign {
  font-family: var(--mono);
  font-size: 0.95rem;
  font-weight: 700;
  align-self: center;
  text-align: center;
  width: 1ch;
}

.update-check-modal-manifest-row-added .update-check-modal-manifest-sign {
  color: var(--win, #4ade80);
}

.update-check-modal-manifest-row-removed .update-check-modal-manifest-sign {
  color: var(--loss);
}

.update-check-modal-manifest-name {
  font-family: var(--mono);
  font-size: 0.78rem;
  color: var(--text);
  align-self: center;
}

@media (prefers-reduced-motion: reduce) {
  .update-check-modal-counts,
  .update-check-modal-manifest { transition: none; }
}
</style>
