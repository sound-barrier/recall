<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { MatchRecord } from '@/api-client'
import MatchProvenanceBadge from '@/components/matches/shared/MatchProvenanceBadge.vue'

// Cursor-anchored hover preview for a leaf row. Floats above the
// cursor on hover; the host (MatchesView) toggles `visible` based
// on `(hover: hover) and (pointer: fine)` media-query state plus
// mouseenter/leave on each row. The preview itself doesn't gate —
// the CSS in app.css drives display:none on touch viewports.
//
// Shows the SUMMARY screenshot thumbnail when there is one, and — for
// an edited or hand-entered match — a provenance badge (the dense
// cozy/compact rows have no room for the data table's Edited /
// User-entered columns, so this hover card is where they surface).
//
// Positioning: offset from the cursor so the preview doesn't sit
// directly under the pointer (which would obscure the row + trigger
// :hover oscillation on the obscured row). 18 px right + 14 px down
// keeps the preview visible AND clear of the row's :hover state.

const props = defineProps<{
  src: string | null
  // Provenance of the hovered match — drives the badge caption. Only
  // edited / manual get one; pure OCR shows just the screenshot.
  source?: MatchRecord['source']
  editedFields?: string[]
  // Cursor coords in viewport space (clientX / clientY).
  x: number
  y: number
}>()

// Defense-in-depth: the server only sends a `src` for a screenshot it verified
// on disk, but a file can still vanish (deleted/moved) between the list load and
// the hover. If the image 404s, drop it so the preview never shows a broken
// thumbnail — and collapse the whole card when there's nothing else to show.
const imgFailed = ref(false)
watch(() => props.src, () => { imgFailed.value = false })

const hasThumbnail = computed(() => !!props.src && !imgFailed.value)
const showProvenance = computed(() => props.source === 'manual' || props.source === 'ocr_edited')
const show = computed(() => hasThumbnail.value || showProvenance.value)

const styleObj = computed(() => ({
  transform: `translate(${props.x + 18}px, ${props.y + 14}px)`,
}))
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="leaf-hover-preview" :style="styleObj" aria-hidden="true">
      <img v-if="src && !imgFailed" :src="src" alt="" loading="eager" @error="imgFailed = true">
      <div v-if="showProvenance" class="leaf-hover-prov" data-hover-prov>
        <MatchProvenanceBadge :source="source" :edited-fields="editedFields" />
      </div>
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

/* Provenance badge caption. Sits under the thumbnail when there is one,
   or stands alone for a hand-entered match (which has no screenshot). */
.leaf-hover-prov {
  display: flex;
  justify-content: center;
  padding-top: 2px;
}

.leaf-hover-preview > .leaf-hover-prov:only-child {
  padding-top: 0;
}

/* Touch-device gate — no hover, no preview. The CSS-only gate means
   the host doesn't need a JS media-query subscription; the preview
   is simply never visible on touch viewports. */
@media (hover: none), (pointer: coarse) {
  .leaf-hover-preview { display: none !important; }
}
</style>
