<script setup lang="ts">
// Inline management chrome for a full-width dossier section (Campaign
// Log, Geography). The section's own band renders in the default slot;
// this wrapper overlays a quiet, hover-revealed cluster — a drag grip
// (reorder among the sections, which always sit below the dossier) and
// a × (remove the section). Re-adding a removed section happens from
// the dossier's Add menu.
//
// No edit mode: the chrome is always present but low-opacity until the
// section is hovered/focused, so each band reads as itself, not a UI
// scaffold. The grip is a button so keyboard users get the same
// reorder via Arrow keys; mouse users drag it.

const props = defineProps<{
  id: string
  label: string
  // Position among the VISIBLE sections + the total, for the grip's
  // accessible label and to disable up/down at the ends.
  index: number
  count: number
  dragging?: boolean
  dropTarget?: boolean
}>()

const emit = defineEmits<{
  remove: [id: string]
  move: [id: string, dir: -1 | 1]
  'drag-start': [id: string, e: DragEvent]
  'drag-end': []
  'drag-over': [id: string, e: DragEvent]
  drop: [id: string, e: DragEvent]
}>()

function onGripKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
    e.preventDefault()
    if (props.index > 0) emit('move', props.id, -1)
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
    e.preventDefault()
    if (props.index < props.count - 1) emit('move', props.id, 1)
  }
}
</script>

<template>
  <div
    class="dossier-section"
    :class="{ 'dossier-section-dragging': dragging, 'dossier-section-drop-target': dropTarget }"
    :data-section="id"
    @dragover.prevent="emit('drag-over', id, $event)"
    @drop="emit('drop', id, $event)"
  >
    <div class="dossier-section-chrome" :data-section-chrome="id">
      <button
        type="button"
        class="dossier-section-grip"
        draggable="true"
        :data-section-grip="id"
        :aria-label="`Reorder ${label} (${index + 1} of ${count}). Arrow keys move it up or down.`"
        @dragstart="emit('drag-start', id, $event)"
        @dragend="emit('drag-end')"
        @keydown="onGripKeydown"
      >
        <span aria-hidden="true">⋮⋮</span>
      </button>
      <button
        type="button"
        class="dossier-section-remove"
        :data-section-remove="id"
        :aria-label="`Remove ${label}`"
        @click="emit('remove', id)"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
    <slot />
  </div>
</template>

<style scoped>
.dossier-section {
  position: relative;
}

/* Quiet management cluster floating at the section's top-right, in the
   ~0.65rem gap above the band so it never collides with the band's own
   header. Hidden at rest, revealed on hover/focus (matches the widget
   chrome). z-index 6 sits ABOVE the Campaign Log's sticky wrapper
   (z-index 4, opaque bg) so the first section's controls aren't
   half-occluded by it the way z-index 3 was. */
.dossier-section-chrome {
  position: absolute;
  top: -11px;
  right: 8px;
  z-index: 6;
  display: inline-flex;
  gap: 3px;
  opacity: 0;
  transition: opacity var(--duration-fast) ease;
}

.dossier-section:hover .dossier-section-chrome,
.dossier-section:focus-within .dossier-section-chrome {
  opacity: 1;
}

/* Compact, native-dialog-sized buttons — same footprint as the widget
   controls. */
.dossier-section-grip,
.dossier-section-remove {
  width: 17px;
  height: 17px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  font-family: var(--mono);
  font-weight: 700;
  line-height: 1;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 2px;
  color: var(--text-faint);
  cursor: pointer;
  user-select: none;
  box-shadow: 0 3px 8px -5px rgb(0 0 0 / 45%);
  transition: color var(--duration-fast) ease,
              border-color var(--duration-fast) ease,
              background var(--duration-fast) ease;
}

.dossier-section-grip {
  cursor: grab;
  font-size: 0.62rem;
}
.dossier-section-grip:active { cursor: grabbing; }

.dossier-section-remove { font-size: 0.78rem; }

.dossier-section-grip:hover {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft);
}

.dossier-section-remove:hover {
  color: var(--loss);
  border-color: var(--loss-line, var(--loss));
  background: color-mix(in srgb, var(--loss) 12%, var(--surface));
}

.dossier-section-grip:focus-visible,
.dossier-section-remove:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
  opacity: 1;
}

.dossier-section-dragging {
  opacity: 0.4;
}

/* A leading accent rule when this section is the drop target, so the
   reorder lands visibly. */
.dossier-section-drop-target::before {
  content: '';
  position: absolute;
  inset: -4px -2px auto;
  height: 3px;
  background: var(--accent);
  border-radius: 2px;
  z-index: 4;
}

@media (prefers-reduced-motion: reduce) {
  .dossier-section-chrome,
  .dossier-section-grip,
  .dossier-section-remove {
    transition: none;
  }
}
</style>
