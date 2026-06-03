<script setup lang="ts">
// Persistent "+" tile rendered as the last cell of the last dashboard
// row when the dossier is in edit mode. Click opens the customizer
// modal in "add" mode.
//
// Visually a deliberate "tactical add slot" — diagonal hatch pattern
// background + dashed accent border + pulse animation so it reads as
// an interactive workspace affordance, not a dead cell. The "+ ADD
// WIDGET" label is spelled out (not just a bare "+") so first-time
// users don't have to puzzle out the affordance.

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
    <span class="dashboard-add-tile-glyph" aria-hidden="true">+</span>
    <span class="dashboard-add-tile-label">Add widget</span>
  </button>
</template>

<style scoped>
.dashboard-add-tile {
  appearance: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  min-height: 4.5rem;
  padding: 0.7rem 0.85rem;
  font-family: var(--mono);
  font-weight: 700;
  line-height: 1;
  color: var(--accent);
  background:
    repeating-linear-gradient(135deg,
      transparent 0 8px,
      color-mix(in srgb, var(--accent) 7%, transparent) 8px 9px),
    transparent;
  border: 1px dashed var(--accent);
  border-radius: 2px;
  cursor: pointer;
  position: relative;
  isolation: isolate;
  transition: background-color 140ms ease, color 140ms ease,
              border-color 140ms ease, transform 140ms ease;

  /* Subtle attention pulse to draw the eye in edit mode. The pulse
     animates a shadow ring outward — cheaper than re-painting the
     border, and stays away from the actual border so the hatch
     pattern doesn't fight it. */
  animation: dashboard-add-tile-pulse 2.8s ease-in-out infinite;
}

@keyframes dashboard-add-tile-pulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 30%, transparent); }
  50%      { box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 0%, transparent); }
}

.dashboard-add-tile-glyph {
  font-size: 1.6rem;
  font-weight: 400;
  line-height: 1;
}

.dashboard-add-tile-label {
  font-size: 0.6rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
}

.dashboard-add-tile:hover {
  background:
    repeating-linear-gradient(135deg,
      transparent 0 8px,
      color-mix(in srgb, var(--accent) 14%, transparent) 8px 9px),
    var(--accent-soft);
  color: var(--text);
  border-color: var(--accent);
  transform: translateY(-1px);
}

.dashboard-add-tile:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.dashboard-add-tile:active {
  transform: translateY(0);
}

@media (prefers-reduced-motion: reduce) {
  .dashboard-add-tile { transition: none; animation: none; }
}
</style>
