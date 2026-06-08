<script setup lang="ts">
import { computed } from 'vue'

// Cursor-anchored hover preview for a leaf row. Floats above the
// cursor on hover; the host (MatchesView) toggles `visible` based
// on `(hover: hover) and (pointer: fine)` media-query state plus
// mouseenter/leave on each row. The preview itself doesn't gate —
// the CSS in app.css drives display:none on touch viewports.
//
// Positioning: offset from the cursor so the preview doesn't sit
// directly under the pointer (which would obscure the row + trigger
// :hover oscillation on the obscured row). 18 px right + 14 px down
// keeps the preview visible AND clear of the row's :hover state.

const props = defineProps<{
  src: string | null
  // Cursor coords in viewport space (clientX / clientY).
  x: number
  y: number
}>()

const styleObj = computed(() => ({
  transform: `translate(${props.x + 18}px, ${props.y + 14}px)`,
}))
</script>

<template>
  <Teleport to="body">
    <div v-if="src" class="leaf-hover-preview" :style="styleObj" aria-hidden="true">
      <img :src="src" alt="" loading="eager">
    </div>
  </Teleport>
</template>

<style scoped>
.leaf-hover-preview {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 120;
  pointer-events: none;
  background: var(--surface);
  border: 1px solid var(--accent);
  border-radius: 2px;
  padding: 2px;
  box-shadow: 0 18px 36px -18px rgb(0 0 0 / 55%);

  /* Compose translate transform from inline style — keeps the GPU
     transform pipeline alive (cheap re-position on mousemove). */
  will-change: transform;
}

.leaf-hover-preview img {
  display: block;
  width: 240px;
  height: auto;
  max-height: 180px;
  object-fit: cover;
  border-radius: 1px;
}

/* Touch-device gate — no hover, no preview. The CSS-only gate means
   the host doesn't need a JS media-query subscription; the preview
   is simply never visible on touch viewports. */
@media (hover: none), (pointer: coarse) {
  .leaf-hover-preview { display: none !important; }
}
</style>
