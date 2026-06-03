<script setup lang="ts">
// Persistent "+" tile rendered as the last cell of the last dashboard
// row when the dossier is in edit mode. Click opens the customizer
// modal in "add" mode.

defineEmits<{ click: [] }>()
</script>

<template>
  <button
    type="button"
    class="dashboard-add-tile"
    aria-label="Add a widget to the dashboard"
    data-add-tile
    @click="$emit('click')"
  >
    <span aria-hidden="true">+</span>
  </button>
</template>

<style scoped>
.dashboard-add-tile {
  appearance: none;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 4.5rem;
  padding: 0.55rem 0.7rem 0.6rem;
  font-family: var(--mono);
  font-size: 1.75rem;
  font-weight: 700;
  line-height: 1;
  color: var(--accent);
  background: transparent;
  border: 1px dashed var(--accent);
  border-radius: 2px;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease;
}

.dashboard-add-tile:hover {
  background: var(--accent-soft);
}

.dashboard-add-tile:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--accent-soft);
}

@media (prefers-reduced-motion: reduce) {
  .dashboard-add-tile { transition: none; }
}
</style>
