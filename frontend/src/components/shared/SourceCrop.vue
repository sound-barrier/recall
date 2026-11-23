<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import type { FieldRegion } from '@/api-client'
import { useWriteGate } from '@/composables/shared/useWriteGate'
import { screenshotURL } from '@/match/match-helpers'
import { cropLayout } from '@/match/quality/crop-geometry'
import { useUiStore } from '@/stores/ui'

// The pixels a field was read from, cut live out of the screenshot the match
// already serves: the whole image drawn inside a box that clips it to the
// read rectangle (layout in match/quality/crop-geometry). No crop is stored.
//
// Shared because the same crop sits beside a flagged reading on the Unknown
// tab and beside each read value in the match's own detail.
//
// Design rule 8: a coaching session loans records, never files, so no
// /_screenshot/ URL is built while one is open — it would resolve against the
// COACH's own disk under the player's filenames. The guard lives here so no
// caller can forget it.
const props = defineProps<{
  region: FieldRegion
  /** What the field is called, for the crop's accessible name. */
  label: string
}>()

const { sessionActive } = useWriteGate()
const { preview } = useUiStore()

const url = computed(() => screenshotURL(props.region.source_file, props.region.dir_id))
const layout = computed(() => cropLayout(props.region))
// The parent keys a crop by its file and rect, so a new region is a new
// component and this never needs resetting.
const failed = ref(false)

// Several crops of one screenshot share the bytes: warm the browser cache
// once through the shared preload registry and every <img> reads from it.
onMounted(() => {
  if (!sessionActive.value && layout.value) preview.preload(url.value)
})

const boxStyle = computed(() => layout.value && {
  width: `min(100%, ${layout.value.widthPx}px)`,
  aspectRatio: String(layout.value.aspectRatio),
})
const imageStyle = computed(() => layout.value && {
  width: `${layout.value.image.widthPct}%`,
  height: `${layout.value.image.heightPct}%`,
  left: `${layout.value.image.leftPct}%`,
  top: `${layout.value.image.topPct}%`,
})
</script>

<template>
  <p v-if="sessionActive" class="source-crop-note">
    Screenshots aren't included in a coaching session.
  </p>
  <p v-else-if="failed" class="source-crop-note source-crop-missing">
    Source missing: <span class="mono">{{ region.source_file }}</span> isn't in the screenshots folder.
  </p>
  <p v-else-if="!layout" class="source-crop-note">
    No usable crop recorded for this reading — Re-parse All to record it again.
  </p>
  <div
    v-else
    class="source-crop"
    role="img"
    :aria-label="`Source crop of ${label} from ${region.source_file}`"
    :style="boxStyle || undefined"
  >
    <img :src="url" alt="" class="source-crop-image" :style="imageStyle || undefined" @error="failed = true">
  </div>
</template>

<style scoped>
.source-crop {
  position: relative;
  overflow: hidden;
  background: var(--surface-3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

/* The whole screenshot, placed by percentages of the box. */
.source-crop-image {
  position: absolute;

  /* Magnified digits stay the pixels OCR saw rather than a smoothed guess. */
  image-rendering: pixelated;
}

.source-crop-note {
  margin: 0;
  font-size: var(--type-sm);
  color: var(--text-dim);
}
</style>
